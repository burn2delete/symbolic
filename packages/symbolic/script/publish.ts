#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@symbolic-agent/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

function on(name: string) {
  return process.env[name] !== "false"
}

function repo() {
  return process.env.GH_REPO || process.env.GITHUB_REPOSITORY || "burn2delete/symbolic"
}

function slug() {
  return repo().toLowerCase()
}

function host() {
  return `https://github.com/${repo()}`
}

function link(tag: string, file: string) {
  return `${host()}/releases/download/v${tag}/${file}`
}

async function seen(name: string, version: string) {
  const result = await $`npm view ${`${name}@${version}`} version`.nothrow()
  return result.exitCode === 0
}

function npm(name: string) {
  if (name.startsWith("symbolic-")) {
    return `@symbolic-agent/${name}`
  }
  return name
}

function tap() {
  return process.env.SYMBOLIC_HOMEBREW_TAP || `${repo().split("/")[0]}/homebrew-tap`
}

const binaries: { dir: string; name: string; npm: string; version: string }[] = []
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const data = (await Bun.file(`./dist/${filepath}`).json()) as { name: string; version: string }
  binaries.push({
    dir: filepath.replace("/package.json", ""),
    name: data.name,
    npm: npm(data.name),
    version: data.version,
  })
}
console.log("binaries", Object.fromEntries(binaries.map((bin) => [bin.npm, bin.version])))
const version = binaries[0]?.version

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
await Bun.file(`./dist/${pkg.name}/LICENSE`).write(await Bun.file("../../LICENSE").text())

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: process.env.SYMBOLIC_NPM_NAME || "symbolic-agent",
      bin: {
        [pkg.name]: `./bin/${pkg.name}`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: version,
      license: pkg.license,
      repository: {
        type: "git",
        url: host(),
      },
      optionalDependencies: Object.fromEntries(binaries.map((bin) => [bin.npm, bin.version])),
    },
    null,
    2,
  ),
)

if (on("SYMBOLIC_PUBLISH_NPM")) {
  const tasks = binaries.map(async (bin) => {
    if (await seen(bin.npm, bin.version)) {
      console.log("skip", bin.npm, bin.version)
      return
    }
    if (process.platform !== "win32") {
      await $`chmod -R 755 .`.cwd(`./dist/${bin.dir}`)
    }
    const file = `./dist/${bin.dir}/package.json`
    const pkg = (await Bun.file(file).json()) as {
      name: string
      version: string
      repository?: { type: string; url: string }
    }
    pkg.name = bin.npm
    pkg.repository = {
      type: "git",
      url: host(),
    }
    await Bun.write(file, JSON.stringify(pkg, null, 2))
    await $`bun pm pack`.cwd(`./dist/${bin.dir}`)
    await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(`./dist/${bin.dir}`)
  })
  await Promise.all(tasks)
  const name = process.env.SYMBOLIC_NPM_NAME || "symbolic-agent"
  if (!(await seen(name, version))) {
    await $`cd ./dist/${pkg.name} && bun pm pack && npm publish *.tgz --access public --tag ${Script.channel}`
  }
}

if (on("SYMBOLIC_PUBLISH_CONTAINER")) {
  const image = process.env.SYMBOLIC_CONTAINER_IMAGE || `ghcr.io/${slug()}`
  const platforms = "linux/amd64,linux/arm64"
  const tags = [`${image}:${version}`, `${image}:${Script.channel}`]
  const tagFlags = tags.flatMap((t) => ["-t", t])
  await $`docker buildx build --platform ${platforms} ${tagFlags} --push .`
}

// registries
if (!Script.preview) {
  // Calculate SHA values
  const arm64Sha = await $`sha256sum ./dist/symbolic-linux-arm64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const x64Sha = await $`sha256sum ./dist/symbolic-linux-x64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const macX64Sha = await $`sha256sum ./dist/symbolic-darwin-x64.zip | cut -d' ' -f1`.text().then((x) => x.trim())
  const macArm64Sha = await $`sha256sum ./dist/symbolic-darwin-arm64.zip | cut -d' ' -f1`.text().then((x) => x.trim())

  const [pkgver, _subver = ""] = Script.version.split(/(-.*)/, 2)

  // arch
  const binaryPkgbuild = [
    "# Maintainer: dax",
    "# Maintainer: adam",
    "",
    "pkgname='symbolic-bin'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='The AI coding agent built for the terminal.'",
    `url='${host()}'`,
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('symbolic')",
    "conflicts=('symbolic')",
    "depends=('ripgrep')",
    "",
    `source_aarch64=("\${pkgname}_\${pkgver}_aarch64.tar.gz::${host()}/releases/download/v\${pkgver}\${_subver}/symbolic-linux-arm64.tar.gz")`,
    `sha256sums_aarch64=('${arm64Sha}')`,

    `source_x86_64=("\${pkgname}_\${pkgver}_x86_64.tar.gz::${host()}/releases/download/v\${pkgver}\${_subver}/symbolic-linux-x64.tar.gz")`,
    `sha256sums_x86_64=('${x64Sha}')`,
    "",
    "package() {",
    '  install -Dm755 ./symbolic "${pkgdir}/usr/bin/symbolic"',
    "}",
    "",
  ].join("\n")

  if (on("SYMBOLIC_PUBLISH_AUR")) {
    for (const [pkg, pkgbuild] of [["symbolic-bin", binaryPkgbuild]]) {
      for (let i = 0; i < 30; i++) {
        try {
          await $`rm -rf ./dist/aur-${pkg}`
          await $`git clone ssh://aur@aur.archlinux.org/${pkg}.git ./dist/aur-${pkg}`
          await $`cd ./dist/aur-${pkg} && git checkout master`
          await Bun.file(`./dist/aur-${pkg}/PKGBUILD`).write(pkgbuild)
          await $`cd ./dist/aur-${pkg} && makepkg --printsrcinfo > .SRCINFO`
          await $`cd ./dist/aur-${pkg} && git add PKGBUILD .SRCINFO`
          await $`cd ./dist/aur-${pkg} && git commit -m "Update to v${Script.version}"`
          await $`cd ./dist/aur-${pkg} && git push`
          break
        } catch (e) {
          continue
        }
      }
    }
  }

  // Homebrew formula
  const homebrewFormula = [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    "# This file was generated by GoReleaser. DO NOT EDIT.",
    "class Symbolic < Formula",
    `  desc "The AI coding agent built for the terminal."`,
    `  homepage "${host()}"`,
    `  version "${Script.version.split("-")[0]}"`,
    "",
    `  depends_on "ripgrep"`,
    "",
    "  on_macos do",
    "    if Hardware::CPU.intel?",
    `      url "${link(Script.version, "symbolic-darwin-x64.zip")}"`,
    `      sha256 "${macX64Sha}"`,
    "",
    "      def install",
    '        bin.install "symbolic"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm?",
    `      url "${link(Script.version, "symbolic-darwin-arm64.zip")}"`,
    `      sha256 "${macArm64Sha}"`,
    "",
    "      def install",
    '        bin.install "symbolic"',
    "      end",
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
    `      url "${link(Script.version, "symbolic-linux-x64.tar.gz")}"`,
    `      sha256 "${x64Sha}"`,
    "      def install",
    '        bin.install "symbolic"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
    `      url "${link(Script.version, "symbolic-linux-arm64.tar.gz")}"`,
    `      sha256 "${arm64Sha}"`,
    "      def install",
    '        bin.install "symbolic"',
    "      end",
    "    end",
    "  end",
    "end",
    "",
    "",
  ].join("\n")

  if (on("SYMBOLIC_PUBLISH_HOMEBREW")) {
    const token = process.env.GITHUB_TOKEN
    if (!token) {
      console.error("GITHUB_TOKEN is required to update homebrew tap")
      process.exit(1)
    }
    const url = `https://x-access-token:${token}@github.com/${tap()}.git`
    await $`rm -rf ./dist/homebrew-tap`
    await $`git clone ${url} ./dist/homebrew-tap`
    await Bun.file("./dist/homebrew-tap/symbolic.rb").write(homebrewFormula)
    await $`cd ./dist/homebrew-tap && git add symbolic.rb`
    await $`cd ./dist/homebrew-tap && git commit -m "Update to v${Script.version}"`
    await $`cd ./dist/homebrew-tap && git push`
  }
}

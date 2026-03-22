#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@symbolic/script"
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

function tap() {
  return process.env.SYMBOLIC_HOMEBREW_TAP || `${repo().split("/")[0]}/homebrew-tap`
}

const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const pkg = await Bun.file(`./dist/${filepath}`).json()
  binaries[pkg.name] = pkg.version
}
console.log("binaries", binaries)
const version = Object.values(binaries)[0]

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
await Bun.file(`./dist/${pkg.name}/LICENSE`).write(await Bun.file("../../LICENSE").text())

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: process.env.SYMBOLIC_NPM_NAME || pkg.name,
      bin: {
        [pkg.name]: `./bin/${pkg.name}`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: version,
      license: pkg.license,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

if (on("SYMBOLIC_PUBLISH_NPM")) {
  const tasks = Object.entries(binaries).map(async ([name]) => {
    if (process.platform !== "win32") {
      await $`chmod -R 755 .`.cwd(`./dist/${name}`)
    }
    await $`bun pm pack`.cwd(`./dist/${name}`)
    await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(`./dist/${name}`)
  })
  await Promise.all(tasks)
  await $`cd ./dist/${pkg.name} && bun pm pack && npm publish *.tgz --access public --tag ${Script.channel}`
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

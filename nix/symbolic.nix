{
  lib,
  stdenvNoCC,
  callPackage,
  bun,
  sysctl,
  makeBinaryWrapper,
  models-dev,
  ripgrep,
  installShellFiles,
  versionCheckHook,
  writableTmpDirAsHomeHook,
  node_modules ? callPackage ./node-modules.nix { },
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "symbolic";
  inherit (node_modules) version src;
  inherit node_modules;

  nativeBuildInputs = [
    bun
    installShellFiles
    makeBinaryWrapper
    models-dev
    writableTmpDirAsHomeHook
  ];

  configurePhase = ''
    runHook preConfigure

    cp -R ${finalAttrs.node_modules}/. .

    runHook postConfigure
  '';

  env.MODELS_DEV_API_JSON = "${models-dev}/dist/_api.json";
  env.SYMBOLIC_DISABLE_MODELS_FETCH = true;
  env.SYMBOLIC_VERSION = finalAttrs.version;
  env.SYMBOLIC_CHANNEL = "local";

  buildPhase = ''
    runHook preBuild

    cd ./packages/symbolic
    bun --bun ./script/build.ts --single --skip-install
    bun --bun ./script/schema.ts schema.json

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 dist/symbolic-*/bin/symbolic $out/bin/symbolic
    install -Dm644 schema.json $out/share/symbolic/schema.json

    wrapProgram $out/bin/symbolic \
      --prefix PATH : ${
        lib.makeBinPath (
          [
            ripgrep
          ]
          # bun runs sysctl to detect if dunning on rosetta2
          ++ lib.optional stdenvNoCC.hostPlatform.isDarwin sysctl
        )
      }

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    # trick yargs into also generating zsh completions
    installShellCompletion --cmd symbolic \
      --bash <($out/bin/symbolic completion) \
      --zsh <(SHELL=/bin/zsh $out/bin/symbolic completion)
  '';

  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  doInstallCheck = true;
  versionCheckKeepEnvironment = [ "HOME" "SYMBOLIC_DISABLE_MODELS_FETCH" ];
  versionCheckProgramArg = "--version";

  passthru = {
    jsonschema = "${placeholder "out"}/share/symbolic/schema.json";
  };

  meta = {
    description = "The open source coding agent";
    homepage = "https://symbolic.computer/";
    license = lib.licenses.mit;
    mainProgram = "symbolic";
    inherit (node_modules.meta) platforms;
  };
})

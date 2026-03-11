{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    bun
    nodejs_22
  ];

  shellHook = ''
    export BUN_INSTALL="${toString ./.}/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
  '';
}

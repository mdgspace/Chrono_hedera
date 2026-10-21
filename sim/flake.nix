{
  description = "Chrono simulator development shell";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }: {
    devShells = builtins.listToAttrs (map (system: {
      name = system;
      value.default = let pkgs = import nixpkgs { inherit system; }; in
        pkgs.mkShell { packages = [ pkgs.python312 pkgs.uv ]; };
    }) [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" "aarch64-linux" ]);
  };
}

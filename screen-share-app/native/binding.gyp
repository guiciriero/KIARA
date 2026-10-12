/**
 * binding.gyp — Configuração de build do Node Addon (node-gyp)
 * Compila os módulos nativos para captura de tela (DXGI) e áudio por app (WASAPI).
 *
 * Suporte:
 *   Windows : DXGI Desktop Duplication (tela) + WASAPI loopback por processo (áudio)
 *   Linux   : X11/Wayland (tela) + PipeWire (áudio)
 *
 * Para compilar: npm run build (dentro de /native)
 */
{
  "targets": [
    {
      "target_name": "screen_capture",
      "sources": [
        "src/screen_capture.cpp",
        "src/audio_capture.cpp",
        "src/addon_entry.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='win'", {
          "defines": ["PLATFORM_WINDOWS"],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/std:c++17"]
            }
          },
          "libraries": [
            "-ld3d11",
            "-ldxgi",
            "-lole32",
            "-loleaut32",
            "-lavrt",
            "-lmmdevapi"
          ]
        }],
        ["OS=='linux'", {
          "defines": ["PLATFORM_LINUX"],
          "cflags_cc": ["-std=c++17"],
          "libraries": [
            "<!@(pkg-config --libs libpipewire-0.3 x11 xext 2>/dev/null || echo '')"
          ],
          "include_dirs+": [
            "<!@(pkg-config --cflags-only-I libpipewire-0.3 x11 2>/dev/null | sed 's/-I//g' || echo '')"
          ]
        }]
      ]
    }
  ]
}

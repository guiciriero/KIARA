# binding.gyp — configuração de build do Node Addon (node-gyp)
#
# Suporte:
#   Windows : DXGI Desktop Duplication (tela) + WASAPI Process Loopback (áudio por app)
#   macOS   : ScreenCaptureKit (áudio por app, macOS 13+)
#   Linux   : X11 (tela); sem captura de áudio por app
#
# Para compilar: npm run build (dentro de /native)
{
  "targets": [
    {
      "target_name": "screen_capture",
      "sources": [
        "src/screen_capture.cpp",
        "src/audio_capture.cpp",
        "src/audio_backend_stub.cpp",
        "src/addon_entry.cpp"
      ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")",
        "src"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
      "conditions": [
        ["OS=='win'", {
          "defines": ["PLATFORM_WINDOWS", "WIN32_LEAN_AND_MEAN", "NOMINMAX"],
          "sources": ["src/audio_backend_win.cpp"],
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
            "-lmmdevapi",
            "-luser32",
            "-lshell32"
          ]
        }],
        ["OS=='mac'", {
          "defines": ["PLATFORM_MACOS"],
          "sources": ["src/audio_backend_mac.mm"],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "CLANG_CXX_LIBRARY": "libc++",
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "13.0",
            "OTHER_LDFLAGS": [
              "-framework Foundation",
              "-framework AppKit",
              "-framework CoreMedia",
              "-framework CoreAudio",
              "-framework ScreenCaptureKit"
            ]
          }
        }],
        ["OS=='linux'", {
          "defines": ["PLATFORM_LINUX"],
          "cflags_cc": ["-std=c++17"],
          "libraries": [
            "<!@(pkg-config --libs x11 xext 2>/dev/null || echo '')"
          ],
          "include_dirs+": [
            "<!@(pkg-config --cflags-only-I x11 2>/dev/null | sed 's/-I//g' || echo '')"
          ]
        }]
      ]
    }
  ]
}

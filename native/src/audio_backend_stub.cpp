/**
 * audio_backend_stub.cpp
 * Backend vazio para plataformas sem captura de áudio por aplicativo (ex.: Linux).
 */
#include "audio_backend.h"

#if !defined(PLATFORM_WINDOWS) && !defined(PLATFORM_MACOS)

namespace audio_backend {

std::vector<SourceInfo> ListSources() { return {}; }

std::string Start(const std::vector<uint32_t>&, ChunkCallback) {
  return "Captura de áudio por aplicativo não é suportada nesta plataforma.";
}

void Stop() {}

}  // namespace audio_backend

#endif

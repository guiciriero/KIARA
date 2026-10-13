/**
 * audio_backend.h
 * Contrato entre o dispatcher N-API (audio_capture.cpp) e os backends por plataforma:
 *   Windows : audio_backend_win.cpp   (WASAPI Process Loopback)
 *   macOS   : audio_backend_mac.mm    (ScreenCaptureKit)
 *   Outros  : audio_backend_stub.cpp  (sem suporte)
 *
 * Formato de áudio entregue SEMPRE: PCM float32 INTERCALADO (L,R,L,R...),
 * 48000 Hz, 2 canais. O backend é responsável por converter/reamostrar.
 */
#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace audio_backend {

struct SourceInfo {
  uint32_t    pid;
  std::string processName;  // Nome do executável (ex.: "chrome.exe", "Safari")
  std::string displayName;  // Nome amigável para a UI
};

/**
 * Chamado pelo backend a cada bloco de áudio capturado.
 * Pode ser invocado de QUALQUER thread do backend.
 * @param pid     PID do processo de origem
 * @param data    PCM float32 intercalado, tamanho = frames * 2 amostras
 * @param frames  Número de frames (amostras por canal)
 * Os dados só são válidos durante a chamada (o dispatcher copia).
 */
using ChunkCallback = std::function<void(uint32_t pid, const float* data, uint32_t frames)>;

/** Lista processos que podem ter o áudio capturado. Nunca lança exceção. */
std::vector<SourceInfo> ListSources();

/**
 * Inicia a captura dos PIDs informados (uma captura independente por PID).
 * @return string vazia em caso de sucesso, ou mensagem de erro legível (pt-BR).
 */
std::string Start(const std::vector<uint32_t>& pids, ChunkCallback callback);

/**
 * Para todas as capturas e aguarda o término das threads do backend.
 * Após o retorno o callback NUNCA mais será chamado. Idempotente.
 */
void Stop();

}  // namespace audio_backend

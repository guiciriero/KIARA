/**
 * Erro único para captura de tela e áudio. Normaliza as exceções do navegador
 * (DOMException) e do processo nativo em códigos estáveis + mensagem em pt-BR,
 * para a interface nunca depender de nomes de exceção.
 */

export type MediaErrorCode =
  | 'permission-denied'
  | 'not-found'
  | 'cancelled'
  | 'busy'
  | 'no-video'
  | 'audio-unavailable'
  | 'unknown';

const MESSAGES: Record<MediaErrorCode, string> = {
  'permission-denied': 'Permissão negada. Libere o compartilhamento de tela/áudio e tente novamente.',
  'not-found': 'Nenhuma fonte de captura encontrada. Verifique se há uma tela, janela ou aplicativo disponível.',
  'cancelled': 'Seleção cancelada.',
  'busy': 'A fonte está em uso por outro aplicativo ou não pôde ser lida.',
  'no-video': 'Nenhuma faixa de vídeo foi capturada. Selecione uma tela ou janela válida.',
  'audio-unavailable': 'Não foi possível capturar o áudio selecionado.',
  'unknown': 'Ocorreu um erro inesperado. Tente novamente.',
};

export class MediaError extends Error {
  readonly code: MediaErrorCode;

  constructor(code: MediaErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? MESSAGES[code], options);
    this.name = 'MediaError';
    this.code = code;
  }
}

function codeFromDomName(name: string): MediaErrorCode | null {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission-denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'not-found';
    case 'AbortError':
      return 'cancelled';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'busy';
    default:
      return null;
  }
}

/**
 * Converte qualquer valor lançado em MediaError. Erros que já são MediaError
 * passam intactos; Error comum mantém a própria mensagem (ex.: vinda do processo nativo).
 */
export function toMediaError(err: unknown, fallback: MediaErrorCode = 'unknown'): MediaError {
  if (err instanceof MediaError) return err;

  const name = err instanceof Error ? err.name : '';
  const code = codeFromDomName(name);
  if (code) return new MediaError(code, undefined, { cause: err });

  if (err instanceof Error && err.message) {
    return new MediaError(fallback, err.message, { cause: err });
  }
  return new MediaError(fallback, undefined, { cause: err });
}

/** Cancelar o seletor nativo não é falha: a transmissão ativa segue como estava. */
export function isCancellation(err: unknown): boolean {
  return err instanceof MediaError && err.code === 'cancelled';
}

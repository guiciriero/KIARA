import React, { useId } from 'react';
import { IconLock, IconUserCheck, IconShield } from '../UI/Icons';
import { isE2eeSupported } from '../../services/e2ee';
import styles from './RoomOptionsPanel.module.css';

export const MIN_ROOM_PASSWORD = 4;
export const MAX_ROOM_PASSWORD = 64;

export interface RoomOptionsValue {
  password: string;
  requireApproval: boolean;
  privacyMode: boolean;
  /** Criptografia de ponta a ponta da mídia (exige senha) */
  e2ee: boolean;
}

/** Senha vazia é válida (sala sem senha); preenchida precisa ter de 4 a 64 caracteres */
export function isRoomPasswordValid(password: string): boolean {
  return password.length === 0 || (password.length >= MIN_ROOM_PASSWORD && password.length <= MAX_ROOM_PASSWORD);
}

/** Sala E2EE exige senha: é dela que a chave de mídia é derivada */
export function isRoomE2eeValid(value: Pick<RoomOptionsValue, 'password' | 'e2ee'>): boolean {
  return !value.e2ee || value.password.length > 0;
}

interface Props {
  value: RoomOptionsValue;
  onChange: (value: RoomOptionsValue) => void;
  /** As opções valem na criação da sala: ficam travadas durante a transmissão */
  disabled?: boolean;
}

const RoomOptionsPanel: React.FC<Props> = ({ value, onChange, disabled = false }) => {
  const baseId = useId();
  const passwordId = `${baseId}-password`;
  const passwordHintId = `${baseId}-password-hint`;
  const passwordInvalid = !isRoomPasswordValid(value.password);
  const e2eeNeedsPassword = !isRoomE2eeValid(value);
  const e2eeSupported = isE2eeSupported();

  return (
    <section className={styles.container} aria-labelledby={`${baseId}-title`}>
      <div className={styles.header}>
        <IconLock size={16} className={styles.icon} />
        <h2 id={`${baseId}-title`} className={styles.title}>Acesso à sala</h2>
        {disabled && <span className={styles.lockedBadge}>Travado no ar</span>}
      </div>

      <div className={styles.field}>
        <label htmlFor={passwordId} className={styles.label}>Senha (opcional)</label>
        <input
          id={passwordId}
          type="password"
          className={styles.input}
          value={value.password}
          maxLength={MAX_ROOM_PASSWORD}
          autoComplete="new-password"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={passwordInvalid}
          aria-describedby={passwordHintId}
          placeholder="Sem senha"
          onChange={(e) => onChange({ ...value, password: e.target.value })}
        />
        <p
          id={passwordHintId}
          className={passwordInvalid ? styles.hintError : styles.hint}
          role={passwordInvalid ? 'alert' : undefined}
        >
          {passwordInvalid
            ? `A senha precisa ter de ${MIN_ROOM_PASSWORD} a ${MAX_ROOM_PASSWORD} caracteres.`
            : `De ${MIN_ROOM_PASSWORD} a ${MAX_ROOM_PASSWORD} caracteres. Deixe vazio para não exigir senha.`}
        </p>
      </div>

      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={value.requireApproval}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, requireApproval: e.target.checked })}
        />
        <span className={styles.toggleText}>
          <span className={styles.toggleTitle}>
            <IconUserCheck size={14} /> Aprovar cada entrada
          </span>
          <span className={styles.hint}>Você aceita ou nega cada espectador antes de ele ver a tela.</span>
        </span>
      </label>

      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={value.privacyMode}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, privacyMode: e.target.checked })}
        />
        <span className={styles.toggleText}>
          <span className={styles.toggleTitle}>
            <IconShield size={14} /> Modo privacidade
          </span>
          <span className={styles.hint}>
            Esconde seu IP dos espectadores usando um servidor de retransmissão. Só funciona se o
            servidor tiver TURN configurado; a sala criada mostra se foi ativado.
          </span>
        </span>
      </label>

      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={value.e2ee}
          disabled={disabled || !e2eeSupported}
          onChange={(e) => onChange({ ...value, e2ee: e.target.checked })}
        />
        <span className={styles.toggleText}>
          <span className={styles.toggleTitle}>
            <IconLock size={14} /> Criptografia de ponta a ponta
          </span>
          <span className={styles.hint}>
            O vídeo e o áudio são cifrados no seu navegador com uma chave derivada da senha, que o
            servidor não recebe. Usa VP9 (mais pesado para o seu computador) e só funciona em
            navegadores com suporte; a força da cifra é a da senha, então use uma senha longa.
            Quem entra, as estatísticas e a negociação da conexão continuam visíveis ao servidor.
          </span>
          {!e2eeSupported && (
            <span className={styles.hintError} role="status">
              Este navegador não suporta a criptografia de ponta a ponta.
            </span>
          )}
          {e2eeNeedsPassword && (
            <span className={styles.hintError} role="alert">
              Defina uma senha para ativar a criptografia de ponta a ponta.
            </span>
          )}
        </span>
      </label>

    </section>
  );
};

export default RoomOptionsPanel;

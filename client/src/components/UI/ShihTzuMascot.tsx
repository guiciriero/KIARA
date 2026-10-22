import React from 'react';
import styles from './ShihTzuMascot.module.css';

export type MascotState = 'idle' | 'connecting' | 'live' | 'error' | 'locked';

interface ShihTzuMascotProps {
  state?: MascotState;
  size?: number;
  speech?: string;
  className?: string;
}

export const ShihTzuMascot: React.FC<ShihTzuMascotProps> = ({
  state = 'idle',
  size = 120,
  speech,
  className = '',
}) => {
  const stateClass = (() => {
    switch (state) {
      case 'connecting':
        return styles.stateConnecting;
      case 'live':
        return styles.stateLive;
      case 'error':
        return styles.stateError;
      case 'locked':
        return styles.stateLocked;
      default:
        return styles.stateIdle;
    }
  })();

  return (
    <div
      className={`${styles.mascotWrapper} ${stateClass} ${className}`}
      style={{ width: size, height: size }}
      aria-label={`Mascote KIARA Shih Tzu em estado ${state}`}
    >
      {speech && <div className={styles.speechBubble}>{speech}</div>}

      <svg
        className={styles.mascotSvg}
        width={size}
        height={size}
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Gradientes Suaves de Pelagem e Acentos Cyber */}
          <linearGradient id="bodyFurGrad" x1="60" y1="50" x2="60" y2="110" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="70%" stopColor="#e2e8f0" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>

          <linearGradient id="patchFurGrad" x1="40" y1="20" x2="80" y2="90" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="60%" stopColor="#d97706" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>

          <linearGradient id="earLeftGrad" x1="20" y1="30" x2="10" y2="85" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#d97706" />
            <stop offset="60%" stopColor="#b45309" />
            <stop offset="100%" stopColor="#78350f" />
          </linearGradient>

          <linearGradient id="earRightGrad" x1="100" y1="30" x2="110" y2="85" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#d97706" />
            <stop offset="60%" stopColor="#b45309" />
            <stop offset="100%" stopColor="#78350f" />
          </linearGradient>

          <linearGradient id="collarGrad" x1="40" y1="88" x2="80" y2="96" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="50%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>

          <radialGradient id="eyeShine" cx="0.35" cy="0.35" r="0.6">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="40%" stopColor="#ffffff" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>

          <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* ── Cauda Abanando ────────────────────────────────────────── */}
        <g className={styles.tail}>
          <path
            d="M85 88 C95 86, 108 72, 104 60 C100 50, 90 54, 88 64 C86 74, 82 82, 85 88 Z"
            fill="url(#bodyFurGrad)"
          />
          {/* Ponta fofa da cauda */}
          <circle cx="101" cy="58" r="8" fill="#f8fafc" />
          <circle cx="94" cy="54" r="6" fill="#f8fafc" />
        </g>

        {/* ── Corpo ─────────────────────────────────────────────────── */}
        <g className={styles.body}>
          {/* Patas traseiras e tronco */}
          <ellipse cx="60" cy="94" rx="28" ry="18" fill="url(#bodyFurGrad)" />
          
          {/* Patinhas dianteiras */}
          <ellipse cx="48" cy="104" rx="8" ry="6" fill="#f8fafc" />
          <ellipse cx="72" cy="104" rx="8" ry="6" fill="#f8fafc" />
          {/* Dedinhos sutis */}
          <path d="M44 105 C44 107, 46 108, 48 108 M48 108 C50 108, 52 107, 52 105" stroke="#cbd5e1" strokeWidth="1" strokeLinecap="round" />
          <path d="M68 105 C68 107, 70 108, 72 108 M72 108 C74 108, 76 107, 76 105" stroke="#cbd5e1" strokeWidth="1" strokeLinecap="round" />

          {/* Coleira Cyber com medalhão */}
          <path d="M42 88 Q60 96 78 88" stroke="url(#collarGrad)" strokeWidth="4.5" strokeLinecap="round" />
          <circle cx="60" cy="94" r="4.5" fill="#38bdf8" filter="url(#softGlow)" />
          <circle cx="60" cy="94" r="2" fill="#ffffff" />
        </g>

        {/* ── Cabeça e Face do Shih Tzu ─────────────────────────────── */}
        <g className={styles.head}>
          {/* Orelhas caídas e peludas características */}
          <g className={styles.earLeft}>
            <path
              d="M38 42 C20 40, 8 52, 10 74 C11 86, 22 88, 28 80 C34 72, 38 58, 38 42 Z"
              fill="url(#earLeftGrad)"
            />
            {/* Pelos internos da orelha */}
            <path d="M16 66 C18 76, 24 78, 26 72" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
          </g>

          <g className={styles.earRight}>
            <path
              d="M82 42 C100 40, 112 52, 110 74 C109 86, 98 88, 92 80 C86 72, 82 58, 82 42 Z"
              fill="url(#earRightGrad)"
            />
            {/* Pelos internos da orelha */}
            <path d="M104 66 C102 76, 96 78, 94 72" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
          </g>

          {/* Formato base da cabeça peluda */}
          <ellipse cx="60" cy="52" rx="30" ry="26" fill="url(#bodyFurGrad)" />

          {/* Manchas douradas/caramelo dos olhos típicas de Shih Tzu */}
          <path
            d="M36 34 C44 32, 52 40, 48 54 C44 64, 32 60, 32 48 C32 40, 34 35, 36 34 Z"
            fill="url(#patchFurGrad)"
            opacity="0.95"
          />
          <path
            d="M84 34 C76 32, 68 40, 72 54 C76 64, 88 60, 88 48 C88 40, 86 35, 84 34 Z"
            fill="url(#patchFurGrad)"
            opacity="0.95"
          />

          {/* Topete fofo superior (top knot) */}
          <path
            d="M52 28 C54 18, 66 18, 68 28 C64 24, 56 24, 52 28 Z"
            fill="#f8fafc"
          />
          {/* Lacinho do topete */}
          <circle cx="60" cy="26" r="3" fill="#6366f1" />
          <path d="M56 26 L52 22 M64 26 L68 22" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" />

          {/* Focinho e Bigode Fofinho Branco */}
          <ellipse cx="60" cy="62" rx="16" ry="12" fill="#ffffff" />
          <ellipse cx="52" cy="64" rx="9" ry="8" fill="#ffffff" />
          <ellipse cx="68" cy="64" rx="9" ry="8" fill="#ffffff" />

          {/* Olhos Grandes e Expressivos */}
          <g className={styles.eye}>
            {/* Olho Esquerdo */}
            <circle cx="44" cy="48" r="6" fill="#1e1b4b" />
            <circle cx="42.5" cy="46" r="2.5" fill="url(#eyeShine)" />
            <circle cx="46" cy="49.5" r="1.2" fill="#ffffff" />

            {/* Olho Direito */}
            <circle cx="76" cy="48" r="6" fill="#1e1b4b" />
            <circle cx="74.5" cy="46" r="2.5" fill="url(#eyeShine)" />
            <circle cx="78" cy="49.5" r="1.2" fill="#ffffff" />
          </g>

          {/* Narizinho de botão preto (Snout) */}
          <g className={styles.nose}>
            <path
              d="M56 57 C57 55, 63 55, 64 57 C64 60, 61 62, 60 62 C59 62, 56 60, 56 57 Z"
              fill="#0f172a"
            />
            {/* Brilho no nariz */}
            <ellipse cx="58.5" cy="56.5" rx="1.2" ry="0.6" fill="#94a3b8" />

            {/* Boquinha dengosa */}
            <path
              d="M56 63 Q60 66 64 63"
              stroke="#475569"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
            />
          </g>

          {/* Língua opcional quando Ao Vivo / Feliz */}
          {state === 'live' && (
            <path
              d="M58 64 C58 68, 62 68, 62 64 Z"
              fill="#f43f5e"
            />
          )}

          {/* Bochechas coradas sutis */}
          <circle cx="34" cy="58" r="4.5" fill="#f43f5e" opacity="0.25" />
          <circle cx="86" cy="58" r="4.5" fill="#f43f5e" opacity="0.25" />
        </g>
      </svg>
    </div>
  );
};

export default ShihTzuMascot;

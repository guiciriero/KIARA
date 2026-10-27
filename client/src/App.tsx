/**
 * App.tsx — Componente raiz com roteamento.
 * Define as rotas:
 *   /          → Página inicial (selecionar modo)
 *   /broadcast → Modo apresentador
 *   /view/:code → Modo espectador
 */

import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import BroadcastPage from './pages/BroadcastPage';
import ViewerPage from './pages/ViewerPage';
import { SocketProvider } from './services/SocketContext';
import TitleBar from './components/UI/TitleBar';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      {/* SocketProvider garante uma única conexão WebSocket para toda a app */}
      <SocketProvider>
        {/* Barra de título customizada (só no app Electron com frameless window) */}
        <TitleBar />
        <Routes>
          <Route path="/"              element={<HomePage />} />
          <Route path="/broadcast"     element={<BroadcastPage />} />
          <Route path="/view/:code"    element={<ViewerPage />} />
        </Routes>
      </SocketProvider>
    </BrowserRouter>
  );
};

export default App;

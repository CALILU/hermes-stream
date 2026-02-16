import React from 'react';
import { Airplay } from 'lucide-react';

/**
 * Boton de Cast a TV en la barra de controles del VideoPlayer
 * Estados: idle (gris), casting (azul pulsante)
 */
export default function CastButton({ casting, onClick }) {
    return (
        <button
            onClick={onClick}
            title={casting ? 'Enviando a TV...' : 'Enviar a TV'}
            className="relative p-2 rounded-lg transition-all duration-200 hover:bg-white/20"
            style={{
                color: casting ? '#60a5fa' : '#ffffff',
                animation: casting ? 'castPulse 2s ease-in-out infinite' : 'none'
            }}
        >
            <Airplay size={20} />
            {casting && (
                <span
                    className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-blue-400"
                    style={{ animation: 'castDot 1.5s ease-in-out infinite' }}
                />
            )}
            <style>{`
                @keyframes castPulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.6; }
                }
                @keyframes castDot {
                    0%, 100% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.4); opacity: 0.6; }
                }
            `}</style>
        </button>
    );
}

import { useEffect, useRef } from 'react'
import type { GameResult } from '../game/types'
import { GrainsplitGame } from '../game/GrainsplitGame'

interface Props {
    /** Optional: the arcade host and the autoplay harness listen for the result. */
    onGameOver?(result: GameResult): void
}

export default function GameScreen({ onGameOver }: Props) {
    const hostRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const host = hostRef.current
        if (!host) return

        const game = new GrainsplitGame()
        void game.mount(host, {
            onGameOver: (result) => {
                ;(globalThis as unknown as Record<string, unknown>).__gameResult = result
                onGameOver?.(result)
            },
        })

        // The runtime publishes globalThis.__gameState itself, every frame.
        return () => { game.destroy() }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return <div ref={hostRef} className="game-host" />
}

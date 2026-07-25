import GameScreen from './components/GameScreen'

/**
 * The whole app is the game. There is no title menu, ranking screen, ad or
 * shop shell around it: the runtime owns its own title card, result screen and
 * restart, so the shell is one mount point.
 */
export default function App() {
    return <GameScreen />
}

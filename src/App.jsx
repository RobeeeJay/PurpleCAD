import React, { useEffect } from 'react'
import Toolbar from './components/Toolbar'
import Viewport from './components/Viewport'
import TreeView from './components/TreeView'
import './styles/App.css'
import { useStore } from './store'

function App() {
  const items = useStore((state) => state.items)
  const theme = useStore((state) => state.theme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <div className="app-container">
      <Toolbar />
      <div className="main-content">
        <TreeView items={items} />
        <Viewport />
      </div>
    </div>
  )
}

export default App

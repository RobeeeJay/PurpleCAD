import { create } from 'zustand'

const getSystemTheme = () => {
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return 'dark'
}

export const useStore = create((set) => ({
  items: [
    { id: 1, name: 'Sketch 1', type: 'sketch', children: [] },
    { id: 2, name: 'Cube 1', type: 'cube', children: [] },
  ],
  selectedId: null,
  hoveredId: null,
  theme: getSystemTheme(),
  renderMode: 'shaded',
  projectionMode: 'perspective', // 'perspective' or 'isometric'
  widgetVisible: true, // orientation widget visibility
  
  addItem: (item) => set((state) => ({
    items: [...state.items, item]
  })),
  
  selectItem: (id) => set({ selectedId: id }),
  
  setHoveredId: (id) => set({ hoveredId: id }),
  
  setRenderMode: (mode) => set({ renderMode: mode }),
  
  setProjectionMode: (mode) => set({ projectionMode: mode }),
  
  toggleProjectionMode: () => set((state) => ({
    projectionMode: state.projectionMode === 'perspective' ? 'isometric' : 'perspective'
  })),
  
  deleteItem: (id) => set((state) => ({
    items: state.items.filter((item) => item.id !== id)
  })),
  
  toggleItemExpanded: (id) => set((state) => ({
    items: state.items.map((item) =>
      item.id === id ? { ...item, expanded: !item.expanded } : item
    )
  })),
  
  toggleTheme: () => set((state) => ({
    theme: state.theme === 'light' ? 'dark' : 'light'
  })),
  
  toggleWidgetVisibility: () => set((state) => ({
    widgetVisible: !state.widgetVisible
  })),
}))

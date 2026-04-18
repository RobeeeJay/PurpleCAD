# Untitled CAD

A modern web-based CAD application built with React, Three.js, and Vite.

## Features

- **3D Viewport**: WebGL-based 3D visualization with interactive controls
- **Toolbar**: Organized tools for creating, combining, constraining, and rendering
- **Object Tree**: Expandable tree view of CAD objects
- **Rotation Widget**: Interactive view rotation controls in the corner
- **Grid Plane**: XZ-axis aligned grid for reference

## Quick Start

### Prerequisites

- Node.js 16+ and npm

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

The application will automatically open at `http://localhost:3000`

### Building for Production

```bash
npm run build
```

Output will be in the `dist/` directory.

## Usage

### Creating Objects

Click the buttons in the **Create** section of the toolbar to add:
- **Sketch Plane**: A planar sketch surface
- **Cube**: A 3D cube primitive
- **Sphere**: A 3D sphere primitive

### Object Management

- **Select**: Click on objects in the tree view to select them
- **Delete**: Hover over an item and click the ✕ button
- **Expand**: Click the arrow to expand hierarchies

### Camera Controls

- **Mouse Drag**: Click and drag to rotate the view
- **Rotation Widget**: Use the widget in the bottom-right corner for precise rotation control

## Technologies

- **React 18**: UI framework
- **Three.js**: 3D graphics and WebGL rendering
- **Vite**: Build tool and dev server
- **Zustand**: State management
- **CSS3**: Styling with modern layout techniques

## Project Structure

```
src/
├── main.jsx              # Entry point
├── App.jsx               # Main app component
├── store.js              # Zustand state management
├── components/
│   ├── Toolbar.jsx       # Toolbar with tools
│   ├── Viewport.jsx      # 3D viewport with Three.js
│   ├── TreeView.jsx      # Object hierarchy tree
│   └── RotationWidget.jsx # View rotation control
└── styles/
    ├── index.css         # Global styles
    ├── App.css           # App layout
    ├── Toolbar.css       # Toolbar styling
    ├── Viewport.css      # Viewport styling
    ├── TreeView.css      # Tree view styling
    └── RotationWidget.css # Rotation widget styling
```

## License

MIT

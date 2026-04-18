import React, { useRef, useEffect, useCallback } from 'react'
import '../styles/RotationWidget.css'

const RotationWidget = ({ rotationState, onOrientationChange }) => {
  const canvasRef = useRef(null)

  // Cube size and position
  const cubeSize = 3
  const center = 50

  // Define cube vertices (8 corners)
  const cubeVertices = [
    [-cubeSize, -cubeSize, -cubeSize], // 0: back-bottom-left
    [cubeSize, -cubeSize, -cubeSize],  // 1: back-bottom-right
    [cubeSize, cubeSize, -cubeSize],   // 2: back-top-right
    [-cubeSize, cubeSize, -cubeSize],  // 3: back-top-left
    [-cubeSize, -cubeSize, cubeSize],  // 4: front-bottom-left
    [cubeSize, -cubeSize, cubeSize],   // 5: front-bottom-right
    [cubeSize, cubeSize, cubeSize],    // 6: front-top-right
    [-cubeSize, cubeSize, cubeSize]    // 7: front-top-left
  ]

  // Define cube faces (each face is 4 vertices, counter-clockwise when viewed from outside)
  const cubeFaces = [
    { vertices: [0, 1, 2, 3], normal: [0, 0, -1], color: '#4ECDC4', axis: 'Z-', name: 'Back' },     // back face (Z-)
    { vertices: [4, 5, 6, 7], normal: [0, 0, 1], color: '#4ECDC4', axis: 'Z+', name: 'Front' },     // front face (Z+)
    { vertices: [0, 1, 5, 4], normal: [0, -1, 0], color: '#51CF66', axis: 'Y-', name: 'Bottom' },   // bottom face (Y-)
    { vertices: [3, 2, 6, 7], normal: [0, 1, 0], color: '#51CF66', axis: 'Y+', name: 'Top' },       // top face (Y+)
    { vertices: [0, 3, 7, 4], normal: [-1, 0, 0], color: '#FF6B6B', axis: 'X-', name: 'Left' },     // left face (X-)
    { vertices: [1, 2, 6, 5], normal: [1, 0, 0], color: '#FF6B6B', axis: 'X+', name: 'Right' }      // right face (X+)
  ]

  // Define corner orientations (combinations of two axes)
  const cornerOrientations = [
    { name: 'X+Y+Z', rotX: Math.PI/4, rotY: Math.PI/4 },     // Front-top-right
    { name: 'X+Y-Z', rotX: Math.PI/4, rotY: 3*Math.PI/4 },   // Back-top-right  
    { name: 'X-Y+Z', rotX: -Math.PI/4, rotY: Math.PI/4 },    // Front-bottom-right
    { name: 'X-Y-Z', rotX: -Math.PI/4, rotY: 3*Math.PI/4 },  // Back-bottom-right
    { name: '-X+Y+Z', rotX: Math.PI/4, rotY: -Math.PI/4 },   // Front-top-left
    { name: '-X+Y-Z', rotX: Math.PI/4, rotY: -3*Math.PI/4 }, // Back-top-left
    { name: '-X-Y+Z', rotX: -Math.PI/4, rotY: -Math.PI/4 },  // Front-bottom-left
    { name: '-X-Y-Z', rotX: -Math.PI/4, rotY: -3*Math.PI/4 } // Back-bottom-left
  ]

  // Helper function to project 3D point to 2D using isometric projection
  const project3D = useCallback((x, y, z, rotX, rotY) => {
    // Apply camera rotations to the point
    // rotX is elevation (pitch), rotY is azimuth (yaw) - same as viewport
    
    let px = x
    let py = y
    let pz = z
    
    // Rotate around Y axis (azimuth)
    const cosY = Math.cos(rotY)
    const sinY = Math.sin(rotY)
    const x1 = px * cosY - pz * sinY
    const z1 = px * sinY + pz * cosY
    
    // Rotate around X axis (elevation)  
    const cosX = Math.cos(rotX)
    const sinX = Math.sin(rotX)
    const y1 = py * cosX - z1 * sinX
    const z2 = py * sinX + z1 * cosX
    
    // Simple isometric projection
    // Project 3D to 2D using standard isometric angles
    const scale = 7
    const isoX = (x1 - z2) * scale * 0.866  // cos(30°)
    const isoY = (y1 + (x1 + z2) * 0.5) * scale * 0.866
    
    return {
      x: center + isoX,
      y: center - isoY,
      z: z2 // Keep Z for depth sorting
    }
  }, [center])

  // Check if point is inside polygon
  const pointInPolygon = (point, polygon) => {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
          (point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
        inside = !inside
      }
    }
    return inside
  }

  // Handle canvas click for faces and corners
  const handleCanvasClick = useCallback((event) => {
    if (!canvasRef.current || !onOrientationChange) return

    const rect = canvasRef.current.getBoundingClientRect()
    const clickX = event.clientX - rect.left
    const clickY = event.clientY - rect.top
    const rotX = rotationState?.x ?? 0
    const rotY = rotationState?.y ?? 0

    const projectedVertices = cubeVertices.map(([x, y, z]) => project3D(x, y, z, rotX, rotY))

    const sortedFaces = cubeFaces
      .map(face => ({
        ...face,
        avgZ: face.vertices.reduce((sum, index) => sum + projectedVertices[index].z, 0) / 4
      }))
      .sort((a, b) => b.avgZ - a.avgZ)

    for (const face of sortedFaces) {
      const facePoints = face.vertices.map(index => projectedVertices[index])
      if (pointInPolygon({ x: clickX, y: clickY }, facePoints)) {
        let targetRotX = 0
        let targetRotY = 0

        switch (face.axis) {
          case 'X+':
            targetRotX = 0
            targetRotY = Math.PI / 2  // 90° azimuth (right)
            break
          case 'X-':
            targetRotX = 0
            targetRotY = -Math.PI / 2  // -90° azimuth (left)
            break
          case 'Y+':
            targetRotX = Math.PI / 2  // 90° elevation (top)
            targetRotY = 0
            break
          case 'Y-':
            targetRotX = -Math.PI / 2  // -90° elevation (bottom)
            targetRotY = 0
            break
          case 'Z+':
            targetRotX = 0
            targetRotY = 0  // Front view
            break
          case 'Z-':
            targetRotX = 0
            targetRotY = Math.PI  // 180° azimuth (back)
            break
          default:
            targetRotX = 0
            targetRotY = 0
        }

        onOrientationChange(targetRotX, targetRotY)
        return
      }
    }

    const cornerSize = 10
    for (let i = 0; i < cubeVertices.length; i++) {
      const vertex = projectedVertices[i]
      const distance = Math.hypot(clickX - vertex.x, clickY - vertex.y)
      if (distance < cornerSize) {
        const orientation = cornerOrientations[i]
        onOrientationChange(orientation.rotX, orientation.rotY)
        return
      }
    }
  }, [rotationState, onOrientationChange, project3D, cubeVertices, cubeFaces, cornerOrientations])

  // Handle home button click
  const handleHomeClick = useCallback(() => {
    if (onOrientationChange) {
      onOrientationChange(0, 0) // Default isometric view
    }
  }, [onOrientationChange])

  useEffect(() => {
    if (!canvasRef.current || !rotationState) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const size = 100
    canvas.width = size
    canvas.height = size

    const rotX = rotationState.x
    const rotY = rotationState.y

    // Clear canvas
    ctx.clearRect(0, 0, size, size)

    // Draw background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.lineWidth = 1
    ctx.strokeRect(0, 0, size, size)

    // Project all vertices
    const projectedVertices = cubeVertices.map(([x, y, z]) => project3D(x, y, z, rotX, rotY))

    // Sort faces by depth (back to front)
    const sortedFaces = cubeFaces
      .map(face => ({
        ...face,
        avgZ: face.vertices.reduce((sum, i) => sum + projectedVertices[i].z, 0) / 4
      }))
      .sort((a, b) => a.avgZ - b.avgZ)

    // Draw faces
    sortedFaces.forEach(face => {
      const facePoints = face.vertices.map(i => projectedVertices[i])

      // Draw face
      ctx.fillStyle = face.color + '40' // Semi-transparent
      ctx.strokeStyle = face.color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(facePoints[0].x, facePoints[0].y)
      for (let i = 1; i < facePoints.length; i++) {
        ctx.lineTo(facePoints[i].x, facePoints[i].y)
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // Draw face label
      const centerX = facePoints.reduce((sum, p) => sum + p.x, 0) / 4
      const centerY = facePoints.reduce((sum, p) => sum + p.y, 0) / 4
      ctx.fillStyle = face.color
      ctx.font = 'bold 10px Arial'
      ctx.textAlign = 'center'
      ctx.fillText(face.axis, centerX, centerY + 3)
    })

    // Draw corner indicators (small circles)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    projectedVertices.forEach(vertex => {
      ctx.beginPath()
      ctx.arc(vertex.x, vertex.y, 3, 0, Math.PI * 2)
      ctx.fill()
    })

  }, [rotationState, project3D, cubeVertices, cubeFaces])

  return (
    <div className="rotation-widget">
      <canvas
        ref={canvasRef}
        className="rotation-canvas"
        title="Click faces or corners to change view orientation"
        onClick={handleCanvasClick}
        style={{ cursor: 'pointer' }}
      />
      <button
        className="home-button"
        onClick={handleHomeClick}
        title="Reset to default view"
      >
        🏠
      </button>
    </div>
  )
}

export default RotationWidget

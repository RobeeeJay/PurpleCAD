import React, { useRef, useState, useEffect } from 'react'
import '../styles/RotationWidget.css'

const RotationWidget = ({ cameraRef, cameraControlsRef }) => {
  const canvasRef = useRef(null)
  const [rotationX, setRotationX] = useState(0)
  const [rotationY, setRotationY] = useState(0)

  useEffect(() => {
    if (!canvasRef.current || !cameraRef.current || !cameraControlsRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const size = 100
    canvas.width = size
    canvas.height = size

    // Get camera rotation from control ref
    const rotX = cameraControlsRef.current.targetRotationX
    const rotY = cameraControlsRef.current.targetRotationY

    // Draw background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.lineWidth = 1
    ctx.strokeRect(0, 0, size, size)

    const center = size / 2
    const axisLength = 25

    // Helper function to project 3D point to 2D
    const project3D = (x, y, z) => {
      // Apply camera rotations
      let rotatedX = x
      let rotatedY = y * Math.cos(rotX) - z * Math.sin(rotX)
      let rotatedZ = y * Math.sin(rotX) + z * Math.cos(rotX)

      let finalX = rotatedX * Math.cos(rotY) - rotatedZ * Math.sin(rotY)
      let finalY = rotatedY
      let finalZ = rotatedX * Math.sin(rotY) + rotatedZ * Math.cos(rotY)

      // Project to 2D
      const scale = 30 / (10 + finalZ)
      return {
        x: center + finalX * scale,
        y: center - finalY * scale
      }
    }

    // Draw axes with proper perspective
    const axisPoints = {
      x: project3D(axisLength, 0, 0),
      y: project3D(0, axisLength, 0),
      z: project3D(0, 0, axisLength)
    }

    // Draw X axis (Red)
    ctx.strokeStyle = '#FF6B6B'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(center, center)
    ctx.lineTo(axisPoints.x.x, axisPoints.x.y)
    ctx.stroke()
    ctx.fillStyle = '#FF6B6B'
    ctx.font = 'bold 11px Arial'
    ctx.fillText('X', axisPoints.x.x + 2, axisPoints.x.y - 2)

    // Draw Y axis (Green)
    ctx.strokeStyle = '#51CF66'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(center, center)
    ctx.lineTo(axisPoints.y.x, axisPoints.y.y)
    ctx.stroke()
    ctx.fillStyle = '#51CF66'
    ctx.fillText('Y', axisPoints.y.x + 2, axisPoints.y.y - 2)

    // Draw Z axis (Blue)
    ctx.strokeStyle = '#4ECDC4'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(center, center)
    ctx.lineTo(axisPoints.z.x, axisPoints.z.y)
    ctx.stroke()
    ctx.fillStyle = '#4ECDC4'
    ctx.fillText('Z', axisPoints.z.x + 2, axisPoints.z.y - 2)

    // Draw center dot
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.beginPath()
    ctx.arc(center, center, 3, 0, Math.PI * 2)
    ctx.fill()

    setRotationX(rotX)
    setRotationY(rotY)
  }, [cameraRef, cameraControlsRef])

  return (
    <div className="rotation-widget">
      <canvas
        ref={canvasRef}
        className="rotation-canvas"
        title="View rotation indicator"
      />
    </div>
  )
}

export default RotationWidget

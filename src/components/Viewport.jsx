import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import RotationWidget from './RotationWidget'
import '../styles/Viewport.css'
import { useStore } from '../store'

const Viewport = () => {
  const containerRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const rendererRef = useRef(null)
  const objectsRef = useRef({})
  const originalMaterialsRef = useRef({})
  const raycasterRef = useRef(new THREE.Raycaster())
  const mouseRef = useRef(new THREE.Vector2())
  const cameraControlsRef = useRef({
    isRotating: false,
    isPanning: false,
    mouseX: 0,
    mouseY: 0,
    targetRotationX: 0,
    targetRotationY: 0
  })
  
  const items = useStore((state) => state.items)
  const theme = useStore((state) => state.theme)
  const hoveredId = useStore((state) => state.hoveredId)
  const setHoveredId = useStore((state) => state.setHoveredId)
  const renderMode = useStore((state) => state.renderMode)

  useEffect(() => {
    if (!containerRef.current) return

    // Scene setup
    const scene = new THREE.Scene()
    const bgColor = theme === 'light' ? 0xe8e8e8 : 0x1a1a1a
    scene.background = new THREE.Color(bgColor)
    sceneRef.current = scene

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    )
    camera.position.set(10, 10, 10)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 15, 10)
    directionalLight.castShadow = true
    scene.add(directionalLight)

    // Create grid on XZ plane
    const gridSize = 20
    const gridDivisions = 20
    const gridColor1 = theme === 'light' ? 0xcccccc : 0x444444
    const gridColor2 = theme === 'light' ? 0xdddddd : 0x222222
    const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, gridColor1, gridColor2)
    gridHelper.rotation.x = 0 // XZ plane
    scene.add(gridHelper)

    // Add a base plane
    const planeGeometry = new THREE.PlaneGeometry(gridSize, gridSize)
    const planeMaterial = new THREE.MeshLambertMaterial({
      color: theme === 'light' ? 0xf0f0f0 : 0x0a0a0a
    })
    const plane = new THREE.Mesh(planeGeometry, planeMaterial)
    plane.rotation.x = -Math.PI / 2
    plane.receiveShadow = true
    scene.add(plane)

    // Handle window resize
    const handleResize = () => {
      const width = containerRef.current.clientWidth
      const height = containerRef.current.clientHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    window.addEventListener('resize', handleResize)

    // Mouse controls and raycasting
    const controls = cameraControlsRef.current

    const onMouseDown = (e) => {
      if (e.button === 0) {
        // Left mouse button - rotate
        controls.isRotating = true
      } else if (e.button === 2) {
        // Right mouse button - pan
        controls.isPanning = true
      }
      controls.mouseX = e.clientX
      controls.mouseY = e.clientY
    }

    const onMouseMove = (e) => {
      const deltaX = e.clientX - controls.mouseX
      const deltaY = e.clientY - controls.mouseY

      if (controls.isRotating) {
        // Right mouse - rotate camera around origin
        const rotationSpeed = 0.005
        controls.targetRotationY -= deltaX * rotationSpeed
        controls.targetRotationX += deltaY * rotationSpeed

        // Clamp X rotation to prevent over-rotation
        controls.targetRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, controls.targetRotationX))

        // Update camera position based on rotation
        const distance = camera.position.length()
        camera.position.x = Math.sin(controls.targetRotationY) * Math.cos(controls.targetRotationX) * distance
        camera.position.y = Math.sin(controls.targetRotationX) * distance
        camera.position.z = Math.cos(controls.targetRotationY) * Math.cos(controls.targetRotationX) * distance
        camera.lookAt(0, 0, 0)
      } else if (controls.isPanning) {
        // Right mouse - pan camera
        const panSpeed = 0.05
        const right = new THREE.Vector3()
        camera.getWorldDirection(right)
        const upVector = camera.up.clone()
        
        // Calculate pan direction
        right.cross(upVector).normalize()
        const moveRight = right.multiplyScalar(-deltaX * panSpeed)
        
        const moveUp = upVector.clone().multiplyScalar(deltaY * panSpeed)
        
        camera.position.add(moveRight)
        camera.position.add(moveUp)
      } else {
        // No mouse button pressed - raycasting for hover detection
        const rect = renderer.domElement.getBoundingClientRect()
        mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
        mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

        raycasterRef.current.setFromCamera(mouseRef.current, camera)
        const intersects = raycasterRef.current.intersectObjects(Object.values(objectsRef.current))

        if (intersects.length > 0) {
          const hoveredObject = intersects[0].object
          const itemId = hoveredObject.userData.itemId
          setHoveredId(itemId)
        } else {
          setHoveredId(null)
        }
      }

      controls.mouseX = e.clientX
      controls.mouseY = e.clientY
    }

    const onMouseUp = () => {
      controls.isRotating = false
      controls.isPanning = false
    }

    const onMouseWheel = (e) => {
      e.preventDefault()
      const zoomSpeed = 0.1
      const direction = camera.position.clone().normalize()
      const distance = camera.position.length()
      const newDistance = Math.max(2, Math.min(100, distance + e.deltaY * zoomSpeed))
      
      camera.position.copy(direction.multiplyScalar(newDistance))
      camera.lookAt(0, 0, 0)
    }

    // Prevent context menu on right click
    const onContextMenu = (e) => {
      e.preventDefault()
    }

    renderer.domElement.addEventListener('mousedown', onMouseDown)
    renderer.domElement.addEventListener('mousemove', onMouseMove)
    renderer.domElement.addEventListener('mouseup', onMouseUp)
    renderer.domElement.addEventListener('wheel', onMouseWheel, { passive: false })
    renderer.domElement.addEventListener('contextmenu', onContextMenu)

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate)
      renderer.render(scene, camera)
    }
    animate()

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      renderer.domElement.removeEventListener('mousedown', onMouseDown)
      renderer.domElement.removeEventListener('mousemove', onMouseMove)
      renderer.domElement.removeEventListener('mouseup', onMouseUp)
      renderer.domElement.removeEventListener('wheel', onMouseWheel)
      renderer.domElement.removeEventListener('contextmenu', onContextMenu)
      containerRef.current?.removeChild(renderer.domElement)
      renderer.dispose()
    }
  }, [theme, setHoveredId])

  // Update objects when items change
  useEffect(() => {
    if (!sceneRef.current) return

    // Remove old objects
    Object.values(objectsRef.current).forEach((mesh) => {
      sceneRef.current.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
    })
    objectsRef.current = {}
    originalMaterialsRef.current = {}

    // Add new objects
    items.forEach((item) => {
      let geometry
      let color = 0x6B9BD1

      switch (item.type) {
        case 'cube':
          geometry = new THREE.BoxGeometry(2, 2, 2)
          color = 0xFF6B6B
          break
        case 'sphere':
          geometry = new THREE.SphereGeometry(1.5, 32, 32)
          color = 0x51CF66
          break
        case 'sketch':
          geometry = new THREE.PlaneGeometry(3, 3)
          color = 0xFFD93D
          break
        default:
          return
      }

      const material = new THREE.MeshLambertMaterial({ color })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      
      // Position objects to avoid overlap
      mesh.position.y = 2
      mesh.userData.itemId = item.id

      sceneRef.current.add(mesh)
      objectsRef.current[item.id] = mesh
      originalMaterialsRef.current[item.id] = {
        color: new THREE.Color(color),
        emissive: new THREE.Color(0x000000)
      }
    })
  }, [items])

  // Update hover highlighting
  useEffect(() => {
    Object.entries(objectsRef.current).forEach(([itemId, mesh]) => {
      const isHovered = hoveredId === parseInt(itemId)
      
      if (isHovered) {
        // Apply highlight
        mesh.material.emissive.setHex(0x444444)
        mesh.material.needsUpdate = true
      } else {
        // Restore original color
        mesh.material.emissive.setHex(0x000000)
        mesh.material.needsUpdate = true
      }
    })
  }, [hoveredId])

  // Update render mode
  useEffect(() => {
    Object.values(objectsRef.current).forEach((mesh) => {
      switch (renderMode) {
        case 'wireframe':
          mesh.material.wireframe = true
          break
        case 'shaded':
          mesh.material.wireframe = false
          mesh.material.flatShading = false
          break
        case 'smooth':
          mesh.material.wireframe = false
          mesh.material.flatShading = false
          break
        default:
          mesh.material.wireframe = false
      }
      mesh.material.needsUpdate = true
    })
  }, [renderMode])

  return (
    <div className="viewport-container">
      <div ref={containerRef} className="viewport" />
      <RotationWidget cameraRef={cameraRef} cameraControlsRef={cameraControlsRef} />
    </div>
  )
}

export default Viewport

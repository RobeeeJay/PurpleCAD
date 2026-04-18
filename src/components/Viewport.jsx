import React, { useEffect, useRef, useCallback } from 'react'
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
  
  const [rotationState, setRotationState] = React.useState({ x: 0, y: 0 })
  
  // Handle orientation change from rotation widget
  const handleOrientationChange = useCallback((targetRotX, targetRotY) => {
    if (!cameraRef.current || !cameraControlsRef.current) return

    const camera = cameraRef.current
    const controls = cameraControlsRef.current

    // Set target rotations
    controls.targetRotationX = targetRotX
    controls.targetRotationY = targetRotY

    // Update camera position based on new rotation
    const distance = camera.position.length()
    camera.position.x = Math.sin(controls.targetRotationY) * Math.cos(controls.targetRotationX) * distance
    camera.position.y = Math.sin(controls.targetRotationX) * distance
    camera.position.z = Math.cos(controls.targetRotationY) * Math.cos(controls.targetRotationX) * distance
    camera.lookAt(0, 0, 0)

    // Update rotation state for widget
    setRotationState({ x: controls.targetRotationX, y: controls.targetRotationY })

    // Save to localStorage
    saveCameraState()
  }, [])
  
  const items = useStore((state) => state.items)
  const theme = useStore((state) => state.theme)
  const hoveredId = useStore((state) => state.hoveredId)
  const setHoveredId = useStore((state) => state.setHoveredId)
  const renderMode = useStore((state) => state.renderMode)
  const projectionMode = useStore((state) => state.projectionMode)
  const widgetVisible = useStore((state) => state.widgetVisible)

  // Load camera position from localStorage
  const loadCameraState = () => {
    try {
      const saved = localStorage.getItem('cad-camera-state')
      if (saved) {
        return JSON.parse(saved)
      }
    } catch (e) {
      console.warn('Failed to load camera state from localStorage:', e)
    }
    return {
      positionX: 10,
      positionY: 10,
      positionZ: 10,
      rotationX: 0,
      rotationY: 0
    }
  }

  // Save camera position to localStorage
  const saveCameraState = () => {
    if (!cameraRef.current || !cameraControlsRef.current) return
    try {
      const state = {
        positionX: cameraRef.current.position.x,
        positionY: cameraRef.current.position.y,
        positionZ: cameraRef.current.position.z,
        rotationX: cameraControlsRef.current.targetRotationX,
        rotationY: cameraControlsRef.current.targetRotationY
      }
      localStorage.setItem('cad-camera-state', JSON.stringify(state))
    } catch (e) {
      console.warn('Failed to save camera state to localStorage:', e)
    }
  }

  useEffect(() => {
    if (!containerRef.current) return

    // Load saved camera state
    const savedState = loadCameraState()

    // Scene setup
    const scene = new THREE.Scene()
    const bgColor = theme === 'light' ? 0xe8e8e8 : 0x1a1a1a
    scene.background = new THREE.Color(bgColor)
    sceneRef.current = scene

    // Camera setup
    const aspect = containerRef.current.clientWidth / containerRef.current.clientHeight
    const frustumSize = 20

    let camera
    if (projectionMode === 'isometric') {
      camera = new THREE.OrthographicCamera(
        -frustumSize * aspect / 2,
        frustumSize * aspect / 2,
        frustumSize / 2,
        -frustumSize / 2,
        0.1,
        1000
      )
      const distance = Math.max(10, Math.sqrt(
        savedState.positionX * savedState.positionX +
        savedState.positionY * savedState.positionY +
        savedState.positionZ * savedState.positionZ
      ))
      const x = Math.sin(savedState.rotationY) * Math.cos(savedState.rotationX) * distance
      const y = Math.sin(savedState.rotationX) * distance
      const z = Math.cos(savedState.rotationY) * Math.cos(savedState.rotationX) * distance
      camera.position.set(x, y, z)
      camera.lookAt(0, 0, 0)
    } else {
      camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 1000)
      camera.position.set(savedState.positionX, savedState.positionY, savedState.positionZ)
      camera.lookAt(0, 0, 0)
    }
    cameraRef.current = camera
    scene.add(camera)

    // Restore rotation state
    const controls = cameraControlsRef.current
    controls.targetRotationX = savedState.rotationX
    controls.targetRotationY = savedState.rotationY

    // Initialize rotation state for widget
    setRotationState({ x: savedState.rotationX, y: savedState.rotationY })

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0)
    directionalLight.position.set(10, 15, 10)
    directionalLight.castShadow = true
    camera.add(directionalLight)

    // Add additional lights for better chrome reflections
    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5)
    directionalLight2.position.set(-10, 10, -10)
    camera.add(directionalLight2)

    const pointLight = new THREE.PointLight(0xffffff, 0.3, 50)
    pointLight.position.set(0, 10, 0)
    camera.add(pointLight)

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
      const currentCamera = cameraRef.current
      if (!currentCamera) return

      currentCamera.aspect = width / height
      currentCamera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    window.addEventListener('resize', handleResize)

    // Mouse controls and raycasting
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
      const currentCamera = cameraRef.current
      if (!currentCamera) return

      const deltaX = e.clientX - controls.mouseX
      const deltaY = e.clientY - controls.mouseY

      if (controls.isRotating) {
        const rotationSpeed = 0.005
        controls.targetRotationY -= deltaX * rotationSpeed
        controls.targetRotationX += deltaY * rotationSpeed

        controls.targetRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, controls.targetRotationX))

        const distance = currentCamera.position.length()
        currentCamera.position.x = Math.sin(controls.targetRotationY) * Math.cos(controls.targetRotationX) * distance
        currentCamera.position.y = Math.sin(controls.targetRotationX) * distance
        currentCamera.position.z = Math.cos(controls.targetRotationY) * Math.cos(controls.targetRotationX) * distance
        currentCamera.lookAt(0, 0, 0)

        setRotationState({ x: controls.targetRotationX, y: controls.targetRotationY })
      } else if (controls.isPanning) {
        const panSpeed = 0.05
        const right = new THREE.Vector3()
        currentCamera.getWorldDirection(right)
        const upVector = currentCamera.up.clone()

        right.cross(upVector).normalize()
        const moveRight = right.multiplyScalar(-deltaX * panSpeed)
        const moveUp = upVector.clone().multiplyScalar(deltaY * panSpeed)

        currentCamera.position.add(moveRight)
        currentCamera.position.add(moveUp)
      } else {
        const rect = renderer.domElement.getBoundingClientRect()
        mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
        mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

        raycasterRef.current.setFromCamera(mouseRef.current, currentCamera)
        // Raycast against main mesh objects only (not their children)
        const meshArray = Object.values(objectsRef.current)
        const intersects = raycasterRef.current.intersectObjects(meshArray, false)

        if (intersects.length > 0) {
          const hoveredObject = intersects[0].object
          const itemId = hoveredObject.userData?.itemId
          if (itemId) {
            setHoveredId(itemId)
          } else {
            setHoveredId(null)
          }
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
      saveCameraState()
    }

    const onMouseWheel = (e) => {
      e.preventDefault()
      const currentCamera = cameraRef.current
      if (!currentCamera) return

      const zoomSpeed = 0.1
      const direction = currentCamera.position.clone().normalize()
      const distance = currentCamera.position.length()
      const newDistance = Math.max(2, Math.min(100, distance + e.deltaY * zoomSpeed))

      currentCamera.position.copy(direction.multiplyScalar(newDistance))
      currentCamera.lookAt(0, 0, 0)
      saveCameraState()
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
      renderer.render(scene, cameraRef.current)
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
      saveCameraState()
      containerRef.current?.removeChild(renderer.domElement)
      renderer.dispose()
    }
  }, [theme, setHoveredId])

  // Update camera when projection mode changes
  useEffect(() => {
    if (!cameraRef.current || !containerRef.current || !rendererRef.current) return

    const container = containerRef.current
    const renderer = rendererRef.current
    const currentCamera = cameraRef.current
    const currentRotX = cameraControlsRef.current.targetRotationX
    const currentRotY = cameraControlsRef.current.targetRotationY

    const currentPosition = currentCamera.position.clone()

    const aspect = container.clientWidth / container.clientHeight
    const frustumSize = 20

    let newCamera
    if (projectionMode === 'isometric') {
      newCamera = new THREE.OrthographicCamera(
        -frustumSize * aspect / 2,
        frustumSize * aspect / 2,
        frustumSize / 2,
        -frustumSize / 2,
        0.1,
        1000
      )
      const distance = Math.max(10, currentPosition.length())
      const x = Math.sin(currentRotY) * Math.cos(currentRotX) * distance
      const y = Math.sin(currentRotX) * distance
      const z = Math.cos(currentRotY) * Math.cos(currentRotX) * distance
      newCamera.position.set(x, y, z)
      newCamera.lookAt(0, 0, 0)
    } else {
      newCamera = new THREE.PerspectiveCamera(30, aspect, 0.1, 1000)
      newCamera.position.copy(currentPosition)
      newCamera.lookAt(0, 0, 0)
    }

    // Transfer lights from old camera to new camera
    currentCamera.children.forEach((child) => {
      if (child instanceof THREE.Light) {
        currentCamera.remove(child)
        newCamera.add(child)
      }
    })

    // Replace camera in scene
    sceneRef.current.remove(currentCamera)
    sceneRef.current.add(newCamera)
    cameraRef.current = newCamera

    // Update renderer
    renderer.clear()
    renderer.render(sceneRef.current, newCamera)
  }, [projectionMode])

  // Update objects when items change
  useEffect(() => {
    if (!sceneRef.current) return

    // Remove old objects
    Object.values(objectsRef.current).forEach((mesh) => {
      sceneRef.current.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
      // Dispose of edge meshes and materials
      mesh.children.forEach((child) => {
        if (child instanceof THREE.LineSegments) {
          child.geometry.dispose()
          child.material.dispose()
        }
      })
    })
    objectsRef.current = {}
    originalMaterialsRef.current = {}

    // Add new objects
    items.forEach((item) => {
      let geometry
      let color = 0xE0E0E0 // Default grey color

      switch (item.type) {
        case 'cube':
          geometry = new THREE.BoxGeometry(2, 2, 2)
          break
        case 'sphere':
          geometry = new THREE.SphereGeometry(1.5, 32, 32)
          break
        case 'sketch':
          geometry = new THREE.PlaneGeometry(3, 3)
          break
        default:
          return
      }

      // Chrome material with high metalness and low roughness
      const material = new THREE.MeshStandardMaterial({
        color: color,
        metalness: 0.3,
        roughness: 0.5
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      
      // Position objects to avoid overlap
      mesh.position.y = 2
      mesh.userData.itemId = item.id

      // Add edge lines
      const edgesGeometry = new THREE.EdgesGeometry(geometry)
      const edgesMaterial = new THREE.LineBasicMaterial({ 
        color: 0x333333,
        linewidth: 2
      })
      const edgeMesh = new THREE.LineSegments(edgesGeometry, edgesMaterial)
      mesh.add(edgeMesh)

      sceneRef.current.add(mesh)
      objectsRef.current[item.id] = mesh
      originalMaterialsRef.current[item.id] = {
        color: new THREE.Color(color),
        metalness: 0.2,
        roughness: 0.2,
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
      {widgetVisible && (
        <RotationWidget rotationState={rotationState} onOrientationChange={handleOrientationChange} />
      )}
    </div>
  )
}

export default Viewport

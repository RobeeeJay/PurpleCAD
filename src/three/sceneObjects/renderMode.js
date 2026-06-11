// applyRenderMode: switches the scene between "smooth" (PBR + bloom),
// "transparent", and "wireframe" presentations.  Handles material
// swaps, bloom composer lifecycle, background colour, axis/plane
// visibility, and the soft "sketch mode" transparency that lets you
// see through the active sketch plane.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { useStore } from "../../store";
import { DISPLAY_PRECISION_MM, fullCircleSegments } from "./dimensions.js";
import {
  DEFAULT_MESH_COLOR,
  WIREFRAME_DISPLAY_COLOR,
  sceneBackgroundFor,
} from "../theme.js";

export function applyRenderMode(renderMode, ctx) {
  const {
    scene,
    renderer,
    cameraRef,
    objectsRef,
    originalMaterialsRef,
    itemsRef,
    axisGroupRef,
    planeRef,
    sketchPlacementPlanesRef,
    composerRef,
    envTextureRef,
    sketchModeRef,
    printPrecision = null,
  } = ctx;

  if (renderMode === "smooth") {
    if (!envTextureRef.current) {
      const pmremGen = new THREE.PMREMGenerator(renderer);
      pmremGen.compileEquirectangularShader();
      const roomEnv = new RoomEnvironment();
      envTextureRef.current = pmremGen.fromScene(roomEnv).texture;
      pmremGen.dispose();
      roomEnv.dispose();
    }
    scene.environment = envTextureRef.current;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    const bgCanvas = document.createElement("canvas");
    bgCanvas.width = 2;
    bgCanvas.height = 512;
    const bgCtx = bgCanvas.getContext("2d");
    const grad = bgCtx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "#0a0a2e");
    grad.addColorStop(1, "#1a0828");
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0, 0, 2, 512);
    const bgTex = new THREE.CanvasTexture(bgCanvas);
    bgTex.needsUpdate = true;
    scene.background = bgTex;

    if (axisGroupRef.current) axisGroupRef.current.visible = false;
    if (planeRef.current) planeRef.current.visible = false;
    sketchPlacementPlanesRef.current.forEach(({ mesh }) => {
      mesh.visible = false;
    });

    if (!composerRef.current && cameraRef.current) {
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, cameraRef.current));
      composer.addPass(
        new UnrealBloomPass(
          new THREE.Vector2(
            renderer.domElement.clientWidth,
            renderer.domElement.clientHeight,
          ),
          0.25,
          0.5,
          0.85,
        ),
      );
      composer.addPass(new OutputPass());
      composerRef.current = composer;
    }

    Object.values(objectsRef.current).forEach((mesh) => {
      const itemData = itemsRef.current.find(
        (i) => i.id === mesh.userData.itemId,
      );
      if (itemData?.visible === false) {
        mesh.visible = false;
        return;
      }
      if (itemData?.type === "sketch") {
        mesh.visible = false;
        return;
      }
      if (["sphere", "cylinder", "torus"].includes(itemData?.type)) {
        if (
          mesh.userData.hullGeometry &&
          mesh.geometry !== mesh.userData.hullGeometry
        ) {
          mesh.geometry.dispose();
          mesh.geometry = mesh.userData.hullGeometry;
        }
        if (
          mesh.userData.shaderMat &&
          mesh.material !== mesh.userData.shaderMat
        ) {
          mesh.material.dispose();
          mesh.material = mesh.userData.shaderMat;
        }
        return;
      }
      const orig = originalMaterialsRef.current[mesh.userData.itemId];
      const col = orig
        ? orig.color.clone()
        : new THREE.Color(DEFAULT_MESH_COLOR);
      const opacity = orig?.opacity ?? 1;
      const transparent = opacity < 1;
      if (mesh.material) mesh.material.dispose();
      mesh.material = new THREE.MeshPhysicalMaterial({
        color: col,
        metalness: orig?.metalness ?? 0.15,
        roughness: orig?.roughness ?? 0.3,
        clearcoat: orig?.clearcoat ?? 1.0,
        clearcoatRoughness: orig?.clearcoatRoughness ?? 0.1,
        opacity,
        transparent,
        depthWrite: !transparent,
        envMapIntensity: 1.2,
      });
      mesh.children.forEach((child) => {
        child.visible = false;
      });
    });
  } else {
    scene.environment = null;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;
    if (composerRef.current) {
      composerRef.current.dispose();
      composerRef.current = null;
    }

    const bgColor = sceneBackgroundFor(useStore.getState().theme);
    scene.background = new THREE.Color(bgColor);

    if (axisGroupRef.current)
      axisGroupRef.current.visible =
        useStore.getState().axisVisible && !sketchModeRef.current;
    if (planeRef.current && !sketchModeRef.current)
      planeRef.current.visible = true;
    sketchPlacementPlanesRef.current.forEach(({ mesh }) => {
      mesh.visible = true;
    });

    Object.values(objectsRef.current).forEach((mesh) => {
      const itemData = itemsRef.current.find(
        (i) => i.id === mesh.userData.itemId,
      );
      if (itemData?.visible === false) {
        mesh.visible = false;
        return;
      }
      if (itemData?.type === "sketch") {
        // When the user is INSIDE this sketch we want the plane to stay
        // visible but barely-there so the 3D geometry behind it shows
        // through.  All other (non-active) sketches stay at their normal
        // appearance — only this one is the active drawing surface.
        const activeSketchId = useStore.getState().selectedId;
        const isActive =
          sketchModeRef.current && itemData.id === activeSketchId;
        mesh.visible = true;
        if (mesh.material && "opacity" in mesh.material) {
          mesh.material.transparent = true;
          mesh.material.opacity = isActive ? 0.05 : 0.18;
          mesh.material.depthWrite = false;
          mesh.material.needsUpdate = true;
        }
        return;
      }
      // In sketch mode the 3D solids are hidden and represented instead by
      // flat outlines projected onto the sketch plane (sketchGhostGroup, built
      // in useSketchModeEffect) — that's a parallel projection with zero depth,
      // which is what the sketch view wants.
      const inSketch = !!sketchModeRef.current;
      if (inSketch) {
        mesh.visible = false;
        mesh.children.forEach((child) => {
          child.visible = false;
        });
        return;
      }
      const isTransparent = renderMode === "transparent";
      const sketchOpacity = 0.5;
      if (["sphere", "cylinder", "torus"].includes(itemData?.type)) {
        if (renderMode === "wireframe") {
          // Wireframe is a DISPLAY overlay on the smooth shader render — it
          // must look as smooth as the shader, regardless of the user's CSG
          // resolution setting.  We pin it to DISPLAY_PRECISION_MM (the
          // print precision) so it always looks smooth at normal viewing.
          // In print mode the user might want even finer; honour whichever
          // is smaller (more segments).
          const wireframePrecision =
            printPrecision != null
              ? Math.min(printPrecision, DISPLAY_PRECISION_MM)
              : DISPLAY_PRECISION_MM;
          let wfGeo;
          if (itemData.type === "sphere") {
            const w = fullCircleSegments(1.5, wireframePrecision, 32);
            const h = Math.max(8, Math.round(w / 2));
            wfGeo = new THREE.SphereGeometry(1.5, w, h);
          } else if (itemData.type === "cylinder") {
            const s = fullCircleSegments(1, wireframePrecision, 32);
            wfGeo = new THREE.CylinderGeometry(1, 1, 2, s);
          } else {
            const tubular = fullCircleSegments(1.0, wireframePrecision, 32);
            const radial = fullCircleSegments(0.4, wireframePrecision, 16);
            wfGeo = new THREE.TorusGeometry(1.0, 0.4, radial, tubular);
          }
          if (mesh.geometry !== mesh.userData.hullGeometry)
            mesh.geometry.dispose();
          mesh.geometry = wfGeo;
          if (mesh.material !== mesh.userData.shaderMat)
            mesh.material.dispose();
          mesh.material = new THREE.MeshBasicMaterial({
            color: WIREFRAME_DISPLAY_COLOR,
            wireframe: true,
          });
        } else {
          if (
            mesh.userData.hullGeometry &&
            mesh.geometry !== mesh.userData.hullGeometry
          ) {
            mesh.geometry.dispose();
            mesh.geometry = mesh.userData.hullGeometry;
          }
          if (
            mesh.userData.shaderMat &&
            mesh.material !== mesh.userData.shaderMat
          ) {
            mesh.material.dispose();
            mesh.material = mesh.userData.shaderMat;
          }
          // The analytic shader carries its own opacity uniform; flip its
          // transparency flag (and the gl alpha) for transparent mode.
          if (mesh.material.uniforms?.uOpacity) {
            mesh.material.uniforms.uOpacity.value = isTransparent
              ? sketchOpacity
              : 1.0;
          }
          mesh.material.transparent = isTransparent;
          mesh.material.depthWrite = !isTransparent;
          mesh.material.needsUpdate = true;
        }
        return;
      }
      const orig = originalMaterialsRef.current[mesh.userData.itemId];
      const col = orig
        ? orig.color.clone()
        : new THREE.Color(DEFAULT_MESH_COLOR);
      const opacity = isTransparent ? sketchOpacity : (orig?.opacity ?? 1);
      const transparent = isTransparent || opacity < 1;
      if (mesh.material) mesh.material.dispose();
      // Without scene.environment (set only in "smooth" mode) metalness and
      // clearcoat have no reflection source to sample, but they still darken
      // the direct-light response — so force them off here rather than
      // carrying over orig's values.
      mesh.material = new THREE.MeshPhysicalMaterial({
        color: col,
        metalness: 0,
        roughness: orig?.roughness ?? 0.5,
        clearcoat: 0,
        clearcoatRoughness: 0,
        transparent,
        opacity,
        depthWrite: !transparent,
      });
      mesh.material.wireframe = renderMode === "wireframe";
      mesh.children.forEach((child) => {
        child.visible = true;
      });
    });
  }
}

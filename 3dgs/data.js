var APP_DATA = {
  title: "ЖК «МАЯКОВСКИЙ» | 3D-ГЕНПЛАН",
  modelUrl: "https://sparkjs.dev/assets/splats/butterfly.spz",
  
  modelRotation: { x: Math.PI, y: 0, z: 0 },
  modelPosition: { x: 0, y: 0, z: 0 },

  initialCamera: {
    position: { x: 0, y: 1.5, z: 4.5 },
    target: { x: 0, y: 0, z: 0 },
    fov: 45
  },

  cameraLimits: {
    minDistance: 1.5,
    maxDistance: 14.0,
    minPolarAngle: 0.15,
    maxPolarAngle: Math.PI * 0.48,
    enablePan: true,
    maxPanRadius: 6.0
  },

  presets: [
    { name: "Общий план", position: { x: 0, y: 1.5, z: 4.5 }, target: { x: 0, y: 0, z: 0 } },
    { name: "Вид сверху", position: { x: 0.2, y: 4.8, z: 1.2 }, target: { x: 0, y: 0, z: 0 } },
    { name: "Крупный план", position: { x: -1.8, y: 0.9, z: 2.2 }, target: { x: 0, y: 0.1, z: 0 } }
  ],

  hotspots3D: [
    {
      id: "hs_1",
      title: "1-комнатная 39м²",
      subtitle: "Отделка White Box / Ремонт",
      position: { x: 0.3, y: 0.4, z: 0.2 },
      tourUrl: "https://wolf-studio.ru"
    }
  ]
};

// Measured in the final vehicle's Z-up / nose +Y coordinates, in metres.
// Each side and format has its own bumper/recess height, pitch and carrier.
// The plate stays at its manufactured dimensions; never scale it to fit a car.
export const PLATE_FITMENTS = Object.freeze({
  ferrari: {
    remove: [],
    front: {
      surface: ['body', 'grills', 'plastic_gray', 'interior_dark'], carrier: 'grille bridge',
      long: { position: [0, 2.25, .398], pitch: -.035, frame: [.534, .124], anchors: [[-.185, .044], [.185, .044]] },
      compact: { position: [0, 2.25, .385], pitch: -.035, frame: [.314, .164], anchors: [[-.105, .052], [.105, .052]] },
    },
    rear: {
      surface: ['body', 'plastic_gray', 'interior_dark'], carrier: 'rear bumper recess',
      long: { position: [0, -2.19, .623], pitch: .025, frame: [.533, .123], anchors: [[-.18, .025], [.18, .025]] },
      compact: { position: [0, -2.18, .604], pitch: .025, frame: [.313, .163], anchors: [[-.10, .035], [.10, .035]] },
    },
  },
  elantra: {
    remove: [],
    front: {
      surface: ['Elantra part 1', 'Elantra part 15', 'Elantra part 17'], carrier: 'bumper plinth',
      long: { position: [0, 2.20, .475], pitch: -.045, frame: [.535, .126], anchors: [[-.18, .025], [.18, .025]] },
      compact: { position: [0, 2.20, .455], pitch: -.04, frame: [.315, .166], anchors: [[-.10, .035], [.10, .035]] },
    },
    rear: {
      surface: ['Elantra part 1', 'Elantra part 14', 'Elantra part 17'], carrier: 'boot-lid recess',
      long: { position: [0, -2.11, .835], pitch: -.085, frame: [.535, .126], anchors: [[-.18, .025], [.18, .025]] },
      compact: { position: [0, -2.11, .820], pitch: -.06, frame: [.315, .166], anchors: [[-.10, .035], [.10, .035]] },
    },
  },
  amg: {
    // The separate source mesh contains an Illinois plate. It never renders.
    remove: ['body_illinoisplatemerc_0'],
    // The old holder is a disconnected part of the shared interior-plastic
    // primitive. Remove just its measured triangles, keeping the cabin intact.
    removeFaces: [{ mesh: 'body_interior_plastic_0', min: [-.170, -2.375, .388], max: [.172, -2.347, .566] }],
    front: {
      surface: ['body_body_0', 'body_black_plastic_0', 'body_black_0', 'body_black_black_0'], carrier: 'lower grille bridge',
      long: { position: [0, 2.275, .323], pitch: -.025, frame: [.536, .127], anchors: [[-.18, .005], [.18, .005]], clearancePoints: [[0, .025], [0, .032], [0, .040]] },
      // The badge's outer ring ends at Z=.38984. Keep the taller carrier below
      // it with a visible gap, retaining bridge contacts at their original height.
      compact: { position: [0, 2.275, .295], pitch: -.02, frame: [.316, .167], anchors: [[-.10, .053], [.10, .053]], clearancePoints: [[0, .050], [0, .057], [0, .065], [0, .073]] },
    },
    rear: {
      surface: ['body_body_0', 'body_black_plastic_0', 'body_black_0'], carrier: 'rear number recess',
      long: { position: [.001, -2.367, .477], pitch: 0, frame: [.534, .125], anchors: [[-.18, .028], [.18, .028]] },
      compact: { position: [.001, -2.367, .477], pitch: 0, frame: [.314, .165], anchors: [[-.105, .038], [.105, .038]] },
    },
  },
  prado: {
    // These are the two supplied branded plate faces, separate from the body.
    remove: ['Object_108', 'Object_110'],
    front: {
      surface: ['Object_32', 'Object_36', 'Object_80', 'Object_76'], carrier: 'raised bumper pedestal',
      long: { position: [0, 2.405, .710], pitch: -.02, frame: [.536, .127], anchors: [[-.18, -.059], [.18, -.059]] },
      compact: { position: [0, 2.405, .710], pitch: -.015, frame: [.316, .167], anchors: [[-.105, -.0585], [.105, -.0585]] },
    },
    rear: {
      surface: ['Object_36', 'Object_32', 'Object_88', 'Object_94'], carrier: 'tailgate number recess',
      long: { position: [0, -2.435, .982], pitch: .005, frame: [.534, .125], anchors: [[-.18, .026], [.18, .026]] },
      compact: { position: [0, -2.435, .985], pitch: 0, frame: [.314, .165], anchors: [[-.105, .037], [.105, .037]] },
    },
  },
});

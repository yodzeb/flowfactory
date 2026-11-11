// Factory layouts ("levels"). World space is 100 x 56; flow goes left -> right.
// Node kinds:
//   source   {type, rate, jump}                raw material supply (player sets a throttle); jump = size of the last 3 supply upgrades
//   station  {time, slots, queue, wear, defect, repair, route, scrap, fix}
//            route:'quality' -> out[0]=good, out[1]=defect; scrap:true -> defects are discarded; fix:true -> rework
//   batch    {time, cap, queue, maxWait, outType}  oven/freezer: waits for a full load (or maxWait), processes all at once
//   assembly {recipe:{type:n}, outType, time, buffer}
//   split    {route?: 'type', types:{type:outIndex}}  default rule is player-selectable (alternate / least loaded)
//   merge    junction of several belts
//   dock     {cap, loadBase, loadDist, trip}   truck loading: first items go deep in the truck (slow), last ones are near the door
//   sink     market, sells instantly
// Edges: [from, to, {via:[[x,y],...]}?]; output order matters for quality/type routing.

export const ITEM_STYLE = {
  a: { shape: 'circle', color: 'teal' },
  b: { shape: 'triangle', color: 'coral' },
  c: { shape: 'square', color: 'violet' },
  d: { shape: 'circle', color: 'sand' },
  k: { shape: 'square', color: 'amber' },
  f: { shape: 'diamond', color: 'blue' },
  z: { shape: 'hexagon', color: 'ice' },
  h: { shape: 'hexagon', color: 'gold' },
  p: { shape: 'star', color: 'pink' },
};

const T = (t) => Math.pow(6, t - 1); // value & cost multiplier per tier

export const LEVELS = [
  {
    id: 'l1', tier: 1, name: 'Workshop', price: 0, batchSize: 20,
    blurb: 'A simple line. The slowest station sets the pace of the whole line: find it and upgrade it. Supply you cannot absorb piles up at the gate and is then wasted.',
    items: { a: { value: 1 } },
    nodes: [
      { id: 'src', kind: 'source', x: 8, y: 30, type: 'a', rate: 0.4, jump: 1.86, label: 'Supply' },
      { id: 'cut', kind: 'station', x: 28, y: 30, time: 1.6, queue: 4, wear: 0.0015, label: 'Cut' },
      { id: 'pol', kind: 'station', x: 48, y: 30, time: 2.4, queue: 4, wear: 0.003, repair: 5, label: 'Polish' },
      { id: 'pack', kind: 'station', x: 68, y: 30, time: 1.2, queue: 4, label: 'Pack' },
      { id: 'mkt', kind: 'sink', x: 90, y: 30, label: 'Market' },
    ],
    edges: [['src', 'cut'], ['cut', 'pol'], ['pol', 'pack'], ['pack', 'mkt']],
  },
  {
    id: 'l2', tier: 2, name: 'Loading Bay', price: 2.5e3, batchSize: 20,
    blurb: 'Trucks are loaded from the back: the first items take long to carry in, the last ones are quick. While the truck is away, the dock queue fills and stalls the line. Welders wear out faster when their queue is full.',
    items: { a: { value: 1.4 } },
    nodes: [
      { id: 'src', kind: 'source', x: 8, y: 30, type: 'a', rate: 0.42, jump: 2.0, label: 'Supply' },
      { id: 'form', kind: 'station', x: 26, y: 30, time: 1.5, queue: 4, label: 'Form' },
      { id: 'weld', kind: 'station', x: 44, y: 30, time: 1.8, queue: 4, wear: 0.004, repair: 5, label: 'Weld' },
      { id: 'dock', kind: 'dock', x: 64, y: 30, cap: 10, loadBase: 0.35, loadDist: 1.8, trip: 12, queue: 8, label: 'Dock' },
    ],
    edges: [['src', 'form'], ['form', 'weld'], ['weld', 'dock']],
  },
  {
    id: 'l3', tier: 3, name: 'Bakehouse', price: 6e4, batchSize: 24,
    blurb: 'Dough is perishable: it loses value while it waits and is thrown away (with a disposal fee) when too old. The oven only bakes full loads, or after a timeout. Do not overfeed.',
    items: { d: { value: 0.8, life: 30 }, k: { value: 2.2, life: 45 } },
    nodes: [
      { id: 'src', kind: 'source', x: 8, y: 30, type: 'd', rate: 0.8, jump: 1.37, label: 'Flour' },
      { id: 'mix', kind: 'station', x: 25, y: 30, time: 1.2, queue: 5, label: 'Mix' },
      { id: 'oven', kind: 'batch', x: 46, y: 30, cap: 6, time: 7, queue: 6, maxWait: 6, outType: 'k', label: 'Oven' },
      { id: 'cool', kind: 'station', x: 66, y: 30, time: 1.4, queue: 6, label: 'Cool' },
      { id: 'mkt', kind: 'sink', x: 88, y: 30, label: 'Market' },
    ],
    edges: [['src', 'mix'], ['mix', 'oven'], ['oven', 'cool'], ['cool', 'mkt']],
  },
  {
    id: 'l4', tier: 4, name: 'Twin Mills', price: 1.5e6, batchSize: 30,
    blurb: 'Two mills in parallel: A is fast but fragile, B is slow but steady. Strict alternation forces both to the pace of the slowest; "least loaded" adapts. Defects are scrapped at inspection.',
    items: { a: { value: 1.5 } },
    nodes: [
      { id: 'src', kind: 'source', x: 6, y: 28, type: 'a', rate: 0.72, jump: 1.8, label: 'Supply' },
      { id: 'prep', kind: 'station', x: 19, y: 28, time: 1.0, queue: 4, label: 'Prep' },
      { id: 'sp', kind: 'split', x: 31, y: 28, label: 'Split' },
      { id: 'ma', kind: 'station', x: 46, y: 15, time: 1.4, queue: 4, wear: 0.007, defect: 0.04, repair: 8, label: 'Mill A' },
      { id: 'mb', kind: 'station', x: 46, y: 42, time: 2.6, queue: 4, wear: 0.0015, defect: 0.02, label: 'Mill B' },
      { id: 'mg', kind: 'merge', x: 60, y: 28, label: 'Merge' },
      { id: 'qc', kind: 'station', x: 73, y: 28, time: 0.9, queue: 5, scrap: true, label: 'Inspect' },
      { id: 'mkt', kind: 'sink', x: 90, y: 28, label: 'Market' },
    ],
    edges: [['src', 'prep'], ['prep', 'sp'], ['sp', 'ma'], ['sp', 'mb'], ['ma', 'mg'], ['mb', 'mg'], ['mg', 'qc'], ['qc', 'mkt']],
  },
  {
    id: 'l5', tier: 5, name: 'Assembly', price: 4e7, batchSize: 20,
    blurb: 'One circle and two triangles make a hexagon. The two lines must run at the right ratio: any surplus piles up in the bins and blocks its own line.',
    items: { a: { value: 0.5 }, b: { value: 0.5 }, h: { value: 4 } },
    nodes: [
      { id: 'sa', kind: 'source', x: 6, y: 15, type: 'a', rate: 0.35, jump: 1.31, label: 'Circles' },
      { id: 'turn', kind: 'station', x: 24, y: 15, time: 1.6, queue: 4, label: 'Turn' },
      { id: 'sb', kind: 'source', x: 6, y: 43, type: 'b', rate: 0.63, jump: 1.31, label: 'Triangles' },
      { id: 'press', kind: 'station', x: 21, y: 43, time: 1.0, queue: 4, label: 'Press' },
      { id: 'bend', kind: 'station', x: 37, y: 43, time: 1.3, queue: 4, wear: 0.004, repair: 6, label: 'Bend' },
      { id: 'asm', kind: 'assembly', x: 54, y: 29, recipe: { a: 1, b: 2 }, outType: 'h', time: 2.0, buffer: 4, label: 'Assemble' },
      { id: 'dock', kind: 'dock', x: 70, y: 29, cap: 8, loadBase: 0.4, loadDist: 2, trip: 14, queue: 8, label: 'Dock' },
    ],
    edges: [['sa', 'turn'], ['turn', 'asm'], ['sb', 'press'], ['press', 'bend'], ['bend', 'asm'], ['asm', 'dock']],
  },
  {
    id: 'l6', tier: 6, name: 'Rework Loop', price: 1e9, batchSize: 30,
    blurb: 'Defective parts go to rework and back into the machine queue. A worn machine makes more defects, which add more load, which wears it more: this loop can collapse. Keep pressure low.',
    items: { a: { value: 2 } },
    nodes: [
      { id: 'src', kind: 'source', x: 6, y: 24, type: 'a', rate: 0.56, jump: 1.89, label: 'Supply' },
      { id: 'mg', kind: 'merge', x: 18, y: 24, label: 'Merge' },
      { id: 'mach', kind: 'station', x: 32, y: 24, time: 1.1, queue: 6, wear: 0.006, defect: 0.08, repair: 7, label: 'Machine' },
      { id: 'qc', kind: 'station', x: 50, y: 24, time: 0.8, queue: 5, route: 'quality', label: 'Inspect' },
      { id: 'pack', kind: 'station', x: 67, y: 24, time: 1.0, queue: 4, label: 'Pack' },
      { id: 'mkt', kind: 'sink', x: 88, y: 24, label: 'Market' },
      { id: 'rw', kind: 'station', x: 50, y: 46, time: 2.5, queue: 4, fix: true, label: 'Rework' },
    ],
    edges: [['src', 'mg'], ['mg', 'mach'], ['mach', 'qc'], ['qc', 'pack'], ['qc', 'rw'], ['pack', 'mkt'], ['rw', 'mg', { via: [[18, 46]] }]],
  },
  {
    id: 'l7', tier: 7, name: 'Cold Chain', price: 2.5e10, batchSize: 30,
    blurb: 'Fresh fish spoils quickly until frozen. Two batch freezers in parallel, then a truck. Slow freezers mean rotten fish; an early freeze wastes capacity.',
    items: { f: { value: 0.8, life: 40 }, z: { value: 3 } },
    nodes: [
      { id: 'src', kind: 'source', x: 5, y: 28, type: 'f', rate: 0.8, jump: 1.65, label: 'Catch' },
      { id: 'clean', kind: 'station', x: 17, y: 28, time: 0.8, queue: 5, wear: 0.003, label: 'Clean' },
      { id: 'sp', kind: 'split', x: 28, y: 28, label: 'Split' },
      { id: 'fa', kind: 'batch', x: 40, y: 15, cap: 5, time: 9, queue: 5, maxWait: 7, outType: 'z', label: 'Freezer A' },
      { id: 'fb', kind: 'batch', x: 40, y: 41, cap: 5, time: 9, queue: 5, maxWait: 7, outType: 'z', label: 'Freezer B' },
      { id: 'mg', kind: 'merge', x: 52, y: 28, label: 'Merge' },
      { id: 'pack', kind: 'station', x: 61, y: 28, time: 0.9, queue: 6, label: 'Pack' },
      { id: 'dock', kind: 'dock', x: 73, y: 28, cap: 12, loadBase: 0.3, loadDist: 1.6, trip: 16, queue: 10, label: 'Dock' },
    ],
    edges: [['src', 'clean'], ['clean', 'sp'], ['sp', 'fa'], ['sp', 'fb'], ['fa', 'mg'], ['fb', 'mg'], ['mg', 'pack'], ['pack', 'dock']],
  },
  {
    id: 'l8', tier: 8, name: 'Shared Paint', price: 6e11, batchSize: 30,
    blurb: 'Two products share one paint booth, then are sorted by type. If one finishing line jams, the sorter jams for both products (head-of-line blocking).',
    items: { a: { value: 2.5 }, c: { value: 3.5 } },
    nodes: [
      { id: 'sa', kind: 'source', x: 6, y: 14, type: 'a', rate: 0.42, jump: 1.71, label: 'Circles' },
      { id: 'cuta', kind: 'station', x: 19, y: 14, time: 1.3, queue: 4, label: 'Cut A' },
      { id: 'sc', kind: 'source', x: 6, y: 42, type: 'c', rate: 0.35, jump: 1.81, label: 'Squares' },
      { id: 'cutc', kind: 'station', x: 19, y: 42, time: 1.6, queue: 4, label: 'Cut C' },
      { id: 'mg', kind: 'merge', x: 31, y: 28, label: 'Merge' },
      { id: 'paint', kind: 'station', x: 43, y: 28, time: 0.9, queue: 6, wear: 0.005, defect: 0.03, repair: 8, label: 'Paint' },
      { id: 'sort', kind: 'split', x: 54, y: 28, route: 'type', types: { a: 0, c: 1 }, label: 'Sort' },
      { id: 'fina', kind: 'station', x: 65, y: 14, time: 1.5, queue: 4, label: 'Finish A' },
      { id: 'finc', kind: 'station', x: 63, y: 42, time: 1.9, queue: 4, wear: 0.003, label: 'Finish C' },
      { id: 'mkt', kind: 'sink', x: 88, y: 14, label: 'Market' },
      { id: 'dock', kind: 'dock', x: 75, y: 42, cap: 10, loadBase: 0.35, loadDist: 1.8, trip: 15, queue: 8, label: 'Dock' },
    ],
    edges: [['sa', 'cuta'], ['sc', 'cutc'], ['cuta', 'mg'], ['cutc', 'mg'], ['mg', 'paint'], ['paint', 'sort'],
      ['sort', 'fina'], ['sort', 'finc'], ['fina', 'mkt'], ['finc', 'dock']],
  },
  {
    id: 'l9', tier: 9, name: 'Two Stages', price: 1.5e13, batchSize: 24,
    blurb: 'Circle + triangle make a hexagon, hexagon + square make a star. Triangles are perishable. Inspection sends defects to rework, which ships them directly.',
    items: { a: { value: 0.4 }, b: { value: 0.4, life: 40 }, c: { value: 0.4 }, h: { value: 1.5 }, p: { value: 5 } },
    nodes: [
      { id: 'sa', kind: 'source', x: 5, y: 11, type: 'a', rate: 0.38, jump: 1.22, label: 'Circles' },
      { id: 'ma', kind: 'station', x: 17, y: 11, time: 1.4, queue: 4, label: 'Turn' },
      { id: 'sb', kind: 'source', x: 5, y: 28, type: 'b', rate: 0.38, jump: 1.22, label: 'Triangles' },
      { id: 'mb', kind: 'station', x: 17, y: 28, time: 1.2, queue: 4, wear: 0.004, label: 'Press' },
      { id: 'a1', kind: 'assembly', x: 31, y: 19, recipe: { a: 1, b: 1 }, outType: 'h', time: 1.8, buffer: 3, label: 'Join' },
      { id: 'sc', kind: 'source', x: 5, y: 46, type: 'c', rate: 0.38, jump: 1.22, label: 'Squares' },
      { id: 'mc', kind: 'station', x: 24, y: 46, time: 1.5, queue: 4, label: 'Cut' },
      { id: 'a2', kind: 'assembly', x: 44, y: 32, recipe: { h: 1, c: 1 }, outType: 'p', time: 2.2, buffer: 3, wear: 0.004, defect: 0.05, label: 'Assemble' },
      { id: 'qc', kind: 'station', x: 57, y: 32, time: 0.9, queue: 4, route: 'quality', label: 'Inspect' },
      { id: 'rw', kind: 'station', x: 57, y: 48, time: 3, queue: 3, fix: true, label: 'Rework' },
      { id: 'dock', kind: 'dock', x: 71, y: 32, cap: 10, loadBase: 0.35, loadDist: 1.8, trip: 16, queue: 8, label: 'Dock' },
    ],
    edges: [['sa', 'ma'], ['sb', 'mb'], ['ma', 'a1'], ['mb', 'a1'], ['sc', 'mc'], ['a1', 'a2'], ['mc', 'a2'],
      ['a2', 'qc'], ['qc', 'dock'], ['qc', 'rw'], ['rw', 'dock']],
  },
  {
    id: 'l10', tier: 10, name: 'Grand Plant', price: 4e14, batchSize: 30,
    blurb: 'Everything at once: a furnace, perishable triangles on two parallel presses, two assembly stages, strict inspection and two docks. Balance is everything.',
    items: { a: { value: 0.4 }, b: { value: 0.4, life: 45 }, c: { value: 0.3 }, h: { value: 1.5 }, p: { value: 6 } },
    nodes: [
      { id: 'sa', kind: 'source', x: 4, y: 11, type: 'a', rate: 0.32, jump: 1.28, label: 'Circles' },
      { id: 'furn', kind: 'batch', x: 18, y: 11, cap: 6, time: 8, queue: 6, maxWait: 8, wear: 0.002, label: 'Furnace' },
      { id: 'sb', kind: 'source', x: 4, y: 29, type: 'b', rate: 0.36, jump: 1.28, label: 'Triangles' },
      { id: 'spb', kind: 'split', x: 12, y: 29, label: 'Split' },
      { id: 'pb1', kind: 'station', x: 22, y: 23, time: 1.8, queue: 3, wear: 0.005, repair: 7, label: 'Press 1' },
      { id: 'pb2', kind: 'station', x: 22, y: 36, time: 1.8, queue: 3, wear: 0.005, repair: 7, label: 'Press 2' },
      { id: 'mgb', kind: 'merge', x: 31, y: 29, label: 'Merge' },
      { id: 'a1', kind: 'assembly', x: 39, y: 18, recipe: { a: 1, b: 1 }, outType: 'h', time: 1.5, buffer: 3, label: 'Join' },
      { id: 'sc', kind: 'source', x: 4, y: 48, type: 'c', rate: 0.6, jump: 1.28, label: 'Squares' },
      { id: 'mc', kind: 'station', x: 22, y: 48, time: 1.0, queue: 4, label: 'Cut' },
      { id: 'a2', kind: 'assembly', x: 51, y: 32, recipe: { h: 1, c: 2 }, outType: 'p', time: 2, buffer: 4, wear: 0.004, defect: 0.04, label: 'Assemble' },
      { id: 'qc', kind: 'station', x: 62, y: 32, time: 0.8, queue: 4, scrap: true, label: 'Inspect' },
      { id: 'spd', kind: 'split', x: 69, y: 32, label: 'Split' },
      { id: 'd1', kind: 'dock', x: 76, y: 20, cap: 10, loadBase: 0.35, loadDist: 1.8, trip: 18, queue: 6, label: 'Dock 1' },
      { id: 'd2', kind: 'dock', x: 76, y: 44, cap: 10, loadBase: 0.35, loadDist: 1.8, trip: 18, queue: 6, label: 'Dock 2' },
    ],
    edges: [['sa', 'furn'], ['sb', 'spb'], ['spb', 'pb1'], ['spb', 'pb2'], ['pb1', 'mgb'], ['pb2', 'mgb'],
      ['furn', 'a1'], ['mgb', 'a1'], ['sc', 'mc'], ['a1', 'a2'], ['mc', 'a2'], ['a2', 'qc'], ['qc', 'spd'],
      ['spd', 'd1'], ['spd', 'd2']],
  },
];

for (const L of LEVELS) L.valueMult = T(L.tier);

export const LEVEL_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));

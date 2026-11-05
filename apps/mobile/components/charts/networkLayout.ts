import type { CompanyNetwork } from '../../src/types';

export const NETWORK_CENTER = { x: 175, y: 90 };
export const NETWORK_ITERATIONS = 240;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// Geometry constants only: they do not represent relationship strength or risk.
export function computeNetworkLayout(network: CompanyNetwork) {
  const nodes = [...network.nodes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const placed = nodes.map((node, index) => {
    const angle = (index + 0.5) * Math.PI * 2 / Math.max(1, nodes.length);
    return { node, pos: { x: 175 + 115 * Math.cos(angle), y: 90 + 58 * Math.sin(angle) } };
  });
  const connected = new Set(network.edges.flatMap(edge =>
    edge.from === network.center.id ? [edge.to] : edge.to === network.center.id ? [edge.from] : []));
  for (let step = 0; step < NETWORK_ITERATIONS; step += 1) {
    const forces = placed.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const dx = placed[i].pos.x - placed[j].pos.x;
        const dy = placed[i].pos.y - placed[j].pos.y;
        const distance = Math.max(0.01, Math.hypot(dx, dy));
        const force = 1800 / (distance * distance) + Math.max(0, 56 - distance) * 0.3;
        const fx = (distance === 0.01 ? 1 : dx / distance) * force;
        const fy = dy / distance * force;
        forces[i].x += fx; forces[i].y += fy;
        forces[j].x -= fx; forces[j].y -= fy;
      }
      const dx = placed[i].pos.x - NETWORK_CENTER.x;
      const dy = placed[i].pos.y - NETWORK_CENTER.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const repel = 2200 / (distance * distance) + Math.max(0, 66 - distance) * 0.5;
      const attract = connected.has(placed[i].node.id) ? (distance - 95) * 0.035 : 0;
      forces[i].x += dx / distance * (repel - attract);
      forces[i].y += dy / distance * (repel - attract);
    }
    placed.forEach(({ pos }, index) => {
      const cooling = 0.8 * (1 - step / NETWORK_ITERATIONS) + 0.1;
      pos.x = clamp(pos.x + clamp(forces[index].x, -4, 4) * cooling, 28, 322);
      pos.y = clamp(pos.y + clamp(forces[index].y, -4, 4) * cooling, 28, 152);
    });
  }
  return placed;
}

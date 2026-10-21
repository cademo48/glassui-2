import * as THREE from 'three';

export const NOISE_SIZE = 256;

/**
 * Tiling white noise for the sand-blasted grain (RG jitter the normal, B varies brightness).
 * Mipmapped, so the grain averages out instead of shimmering when the slab is small or edge-on.
 */
export function createNoiseTexture(): THREE.DataTexture {
  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE * 4);
  let seed = 0x2f6b9d1;
  // mulberry32: small, fast and deterministic, so every load gets the same grain
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(random() * 256);

  const texture = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

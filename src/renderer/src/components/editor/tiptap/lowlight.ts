import { all, createLowlight } from 'lowlight'

export function buildLowlight() {
  return createLowlight(all)
}

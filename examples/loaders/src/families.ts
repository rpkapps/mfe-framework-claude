import { loaders, type GalleryLoader } from './generated/loaders.js'

/** What a family of loaders is called here; the loaders of their own come first. */
const FAMILY_TITLES: Readonly<Record<string, string>> = {
  'oil-and-gas': 'Oil and gas',
  stratum: 'STRATUM 3D',
}

export function familyTitle(family: string | null): string {
  return family === null ? 'Standalone' : (FAMILY_TITLES[family] ?? family)
}

/** The loaders grouped by family, in the order the generated list gives them. */
export const families: readonly { title: string; loaders: readonly GalleryLoader[] }[] =
  loaders.reduce<{ title: string; loaders: GalleryLoader[] }[]>((groups, loader) => {
    const title = familyTitle(loader.family)
    const group = groups.find(candidate => candidate.title === title)
    if (group === undefined) groups.push({ title, loaders: [loader] })
    else group.loaders.push(loader)
    return groups
  }, [])

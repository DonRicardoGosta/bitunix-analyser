import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface FavouritesState {
  symbols: string[]
  isFav: (symbol: string) => boolean
  add: (symbol: string) => void
  remove: (symbol: string) => void
  toggle: (symbol: string) => void
}

export const useFavourites = create<FavouritesState>()(
  persist(
    (set, get) => ({
      symbols: [],
      isFav: (symbol) => get().symbols.includes(symbol),
      add: (symbol) =>
        set((s) => (s.symbols.includes(symbol) ? s : { symbols: [...s.symbols, symbol] })),
      remove: (symbol) => set((s) => ({ symbols: s.symbols.filter((x) => x !== symbol) })),
      toggle: (symbol) =>
        set((s) =>
          s.symbols.includes(symbol)
            ? { symbols: s.symbols.filter((x) => x !== symbol) }
            : { symbols: [...s.symbols, symbol] },
        ),
    }),
    { name: 'bitunix-favourites' },
  ),
)

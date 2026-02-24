// import { createContext, useContext, useEffect, useState } from "react"
// import { useAppStore } from "@/stores/useAppStore"

// type Theme = "dark" | "light" | "system"

// type ThemeProviderProps = {
//   children: React.ReactNode
//   defaultTheme?: Theme
//   storageKey?: string
// }

// type ThemeProviderState = {
//   theme: Theme
//   setTheme: (theme: Theme) => void
// }

// const initialState: ThemeProviderState = {
//   theme: "system",
//   setTheme: () => null,
// }

// const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

// export function ThemeProvider({
//   children,
//   defaultTheme = "system",
//   storageKey = "vite-ui-theme",
//   ...props
// }: ThemeProviderProps) {
//   // Use the store hook directly to get reactive updates
//   const storeTheme = useAppStore(state => state.theme)
//   const setStoreTheme = useAppStore(state => state.setTheme)

//   // Use store theme directly
//   const theme = storeTheme

//   useEffect(() => {
//     const root = window.document.documentElement

//     root.classList.remove("light", "dark")

//     if (theme === "system") {
//       const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
//         .matches
//         ? "dark"
//         : "light"

//       root.classList.add(systemTheme)
//       return
//     }

//     root.classList.add(theme)
//   }, [theme])

//   const value = {
//     theme,
//     setTheme: (newTheme: Theme) => {
//       setStoreTheme(newTheme)
//     },
//   }

//   return (
//     <ThemeProviderContext.Provider {...props} value={value}>
//       {children}
//     </ThemeProviderContext.Provider>
//   )
// }

// export const useTheme = () => {
//   const context = useContext(ThemeProviderContext)

//   if (context === undefined)
//     throw new Error("useTheme must be used within a ThemeProvider")

//   return context
// }
// Import `?raw` di Vite/Vitest: restituisce il contenuto del file come stringa.
declare module "*?raw" {
  const content: string;
  export default content;
}

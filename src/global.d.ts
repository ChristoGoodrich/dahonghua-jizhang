// Expo generates these declarations when its bundler runs; declare them here so
// `tsc --noEmit` also understands CSS/CSS-module imports used by scaffold files.
declare module '*.css';
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

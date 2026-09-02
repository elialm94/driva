import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // React Compiler-reglerna flaggar 73 befintliga ställen (ref-läsning i
      // render, setState i effekter) som var och en kräver egen granskning.
      // Varning i stället för fel så att `npm run lint` kan grinda CI på nya
      // fel – befintliga träffar ska betas av, inte tystas.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      // `_x` är det etablerade sättet i kodbasen att plocka bort en nyckel ur en
      // rest-destrukturering eller markera en avsiktligt oanvänd parameter.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]);

export default eslintConfig;

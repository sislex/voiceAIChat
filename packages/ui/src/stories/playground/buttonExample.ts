import type { SandpackFiles } from '@codesandbox/sandpack-react'

export const buttonExampleFiles: SandpackFiles = {
  '/App.tsx': {
    code: [
      'import { useState } from "react";',
      'import { Button } from "./Button";',
      'import "./styles.css";',
      '',
      'export default function App() {',
      '  const [count, setCount] = useState(0);',
      '',
      '  return (',
      '    <main className="demo">',
      '      <h1>Кнопка проекта</h1>',
      '      <Button variant="primary" onClick={() => setCount((value) => value + 1)}>',
      '        Нажато: {count}',
      '      </Button>',
      '    </main>',
      '  );',
      '}'
    ].join('\n'),
    active: true
  },
  '/Button.tsx': {
    code: [
      'import { forwardRef, type ButtonHTMLAttributes } from "react";',
      '',
      'type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";',
      'interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {',
      '  variant?: ButtonVariant;',
      '}',
      '',
      'export const Button = forwardRef<HTMLButtonElement, ButtonProps>(',
      '  function Button({ variant = "secondary", className, type = "button", ...props }, ref) {',
      '    const classes = ["vc-btn", "vc-btn--" + variant, className].filter(Boolean).join(" ");',
      '    return <button {...props} ref={ref} type={type} className={classes} />;',
      '  }',
      ');'
    ].join('\n'),
    hidden: true,
    readOnly: true
  },
  '/styles.css': {
    code: [
      ':root {',
      '  font-family: Inter, system-ui, sans-serif;',
      '  color: #24231f;',
      '  background: #f5f3ed;',
      '}',
      'body { margin: 0; }',
      '.demo { display: grid; place-content: center; gap: 16px; min-height: 360px; text-align: center; }',
      '.vc-btn {',
      '  min-height: 40px; padding: 0 18px; border: 1px solid transparent;',
      '  border-radius: 10px; font: inherit; font-weight: 650; cursor: pointer;',
      '}',
      '.vc-btn--primary { color: #fff; background: #4968d8; }',
      '.vc-btn--primary:hover { background: #3d59bd; }',
      '.vc-btn:focus-visible { outline: 3px solid #8fa5f2; outline-offset: 2px; }'
    ].join('\n'),
    hidden: true,
    readOnly: true
  }
}


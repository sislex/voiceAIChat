import { describe, expect, it } from 'vitest'
import { componentsWithoutStories, generateStoriesSource, parseProps } from './makeStoriesGen'

describe('makeStoriesGen', () => {
  it('componentsWithoutStories: пропускает точки входа, сториз, тесты и компоненты с сториз', () => {
    expect(componentsWithoutStories(['src/main.tsx', 'src/App.tsx', 'src/components/Button.tsx', 'src/components/Button.stories.tsx', 'src/components/Card.tsx', 'src/components/Card.test.tsx', 'styles.css'])).toEqual(['src/components/Card.tsx'])
  })
  it('parseProps читает interface с optional и union-литералами', () => {
    const props = parseProps("export interface ButtonProps {\n  label: string // подпись\n  variant?: 'primary' | 'secondary'\n  onClick?: () => void\n  disabled?: boolean;\n}\n")
    expect(props.map((p) => `${p.name}${p.optional ? '?' : ''}:${p.literals.join('|') || p.type}`)).toEqual(['label:string', 'variant?:primary|secondary', 'onClick?:() => void', 'disabled?:boolean'])
  })
  it('generateStoriesSource: Default + по стори на литерал', () => {
    const src = "export interface ButtonProps {\n  label: string\n  variant?: 'primary' | 'secondary'\n  onClick?: () => void\n}\nexport function Button({ label }: ButtonProps) { return <button>{label}</button> }\n"
    const r = generateStoriesSource('src/components/Button.tsx', src)!
    expect(r.path).toBe('src/components/Button.stories.tsx')
    expect(r.content).toBe([
      "import { Button } from './Button'", '',
      "export default { title: 'Button', component: Button }", '',
      'export const Default = () => <Button label="Пример" variant="primary" />',
      'export const Primary = () => <Button variant="primary" label="Пример" />',
      'export const Secondary = () => <Button variant="secondary" label="Пример" />', ''
    ].join('\n'))
  })
  it('default-экспорт без пропсов и файл без компонента', () => {
    expect(generateStoriesSource('src/components/Hero.tsx', 'export default function Hero() { return null }')!.content).toContain("import Hero from './Hero'")
    expect(generateStoriesSource('src/util.tsx', 'export const helper = 1')).toBeNull()
  })
})

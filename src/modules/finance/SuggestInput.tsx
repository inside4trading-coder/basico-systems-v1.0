import { Input } from "@/components/ui/input";

/** Texto libre con sugerencias del catálogo (datalist nativo: sirve en el teclado del teléfono). */
export default function SuggestInput({ id, value, onChange, options, placeholder }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <>
      <Input id={id} list={`${id}-options`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" />
      <datalist id={`${id}-options`}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

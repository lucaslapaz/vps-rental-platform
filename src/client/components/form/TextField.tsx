import type { ComponentProps } from 'react';
import type { FieldError as RhfFieldError, UseFormRegisterReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { validationMessage } from '@/lib/errors';

interface TextFieldProps extends Omit<ComponentProps<typeof Input>, 'id' | 'name'> {
  label: string;
  registration: UseFormRegisterReturn;
  error?: RhfFieldError;
  description?: string;
}

/** Campo de formulário: rótulo, input, dica e erro traduzido (a mensagem do zod é uma chave, errors:validation.*). */
export function TextField({ label, registration, error, description, ...inputProps }: TextFieldProps) {
  useTranslation(); // re-renderiza ao trocar de idioma, para a mensagem de erro acompanhar
  const id = `campo-${registration.name}`;
  const message = validationMessage(error?.message);
  return (
    <Field data-invalid={Boolean(error) || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} aria-invalid={Boolean(error) || undefined} {...inputProps} {...registration} />
      {description && !error ? <FieldDescription>{description}</FieldDescription> : null}
      {message ? <FieldError>{message}</FieldError> : null}
    </Field>
  );
}

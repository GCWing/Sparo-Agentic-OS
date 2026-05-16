import React, { forwardRef, useId } from 'react';
import './Form.scss';

export const FormSection = forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ children, className = '', ...props }, ref) => (
    <section ref={ref} className={['ds-form-section', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </section>
  )
);

FormSection.displayName = 'FormSection';

export interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  controlId?: string;
}

export const FormField = forwardRef<HTMLDivElement, FormFieldProps>(
  ({ label, description, error, required = false, controlId, children, className = '', ...props }, ref) => {
    const generatedId = useId();
    const id = controlId ?? generatedId;
    const descriptionId = description ? `${id}-description` : undefined;
    const errorId = error ? `${id}-error` : undefined;
    const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
    const control = React.isValidElement(children) && typeof children.type !== 'string'
      ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
          id: (children.props as { id?: string }).id ?? id,
          'aria-describedby': [
            (children.props as { 'aria-describedby'?: string })['aria-describedby'],
            describedBy,
          ].filter(Boolean).join(' ') || undefined,
          'aria-invalid': error ? true : (children.props as { 'aria-invalid'?: boolean })['aria-invalid'],
        })
      : children;

    return (
      <div ref={ref} className={['ds-form-field', error && 'ds-form-field--error', className].filter(Boolean).join(' ')} {...props}>
        {(label || description) && (
          <div className="ds-form-field__copy">
            {label && (
              <label className="ds-form-field__label" htmlFor={id}>
                {label}
                {required && <span className="ds-form-field__required">*</span>}
              </label>
            )}
            {description && <div id={descriptionId} className="ds-form-field__description">{description}</div>}
          </div>
        )}
        <div className="ds-form-field__control">
          {control}
        </div>
        {error && <div id={errorId} className="ds-form-field__error">{error}</div>}
      </div>
    );
  }
);

FormField.displayName = 'FormField';

export const FormActions = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, className = '', ...props }, ref) => (
    <div ref={ref} className={['ds-form-actions', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  )
);

FormActions.displayName = 'FormActions';

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageComposer from './MessageComposer';

describe('MessageComposer', () => {
  it('disables the send button until there is content', async () => {
    render(<MessageComposer onSend={() => {}} />);
    const sendButton = screen.getByLabelText('Enviar mensaje');
    expect(sendButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Mensaje'), 'Hola');
    expect(sendButton).toBeEnabled();
  });

  it('sends the trimmed message on button click and clears the input', async () => {
    const onSend = vi.fn();
    render(<MessageComposer onSend={onSend} />);

    await userEvent.type(screen.getByLabelText('Mensaje'), '  Recibido  ');
    await userEvent.click(screen.getByLabelText('Enviar mensaje'));

    expect(onSend).toHaveBeenCalledWith('Recibido', []);
    expect(screen.getByLabelText('Mensaje')).toHaveValue('');
  });

  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    const onSend = vi.fn();
    render(<MessageComposer onSend={onSend} />);
    const textarea = screen.getByLabelText('Mensaje');

    await userEvent.type(textarea, 'Línea 1{Shift>}{Enter}{/Shift}Línea 2');
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('Línea 1\nLínea 2');

    await userEvent.type(textarea, '{Enter}');
    expect(onSend).toHaveBeenCalledWith('Línea 1\nLínea 2', []);
  });

  it('disables the textarea, attach and send controls when disabled', () => {
    render(<MessageComposer onSend={() => {}} disabled />);
    expect(screen.getByLabelText('Mensaje')).toBeDisabled();
    expect(screen.getByLabelText('Adjuntar archivo')).toBeDisabled();
    expect(screen.getByLabelText('Enviar mensaje')).toBeDisabled();
  });

  it('adds a selected file as a pending attachment preview and includes it on send', async () => {
    const onSend = vi.fn();
    render(<MessageComposer onSend={onSend} />);

    const file = new File(['contenido'], 'evidencia.pdf', { type: 'application/pdf' });
    const fileInput = document.querySelector('input[type="file"]');
    await userEvent.upload(fileInput, file);

    expect(screen.getByText('evidencia.pdf')).toBeInTheDocument();
    expect(screen.getByLabelText('Enviar mensaje')).toBeEnabled();

    await userEvent.click(screen.getByLabelText('Enviar mensaje'));
    expect(onSend).toHaveBeenCalledWith('', [expect.objectContaining({ name: 'evidencia.pdf', type: 'document' })]);
  });
});
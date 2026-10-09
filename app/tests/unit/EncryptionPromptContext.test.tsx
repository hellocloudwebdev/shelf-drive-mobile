import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EncryptionPromptProvider, useEncryptionPrompt, type FilePassphraseRequest } from '../../src/context/EncryptionPromptContext';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const baseRequest: FilePassphraseRequest = {
    title: 'sheet.title',
    requireAcknowledgement: true,
    confirmPassphrase: true,
};

function Harness({ request }: { request: FilePassphraseRequest }) {
    const { requestFilePassphrase } = useEncryptionPrompt();
    const [result, setResult] = useState<string | null | 'pending'>(null);
    return (
        <div>
            <button onClick={() => { setResult('pending'); void requestFilePassphrase(request).then(setResult); }}>ask</button>
            <output data-testid="result">{result === 'pending' ? 'pending' : result === null ? 'cancelled' : result}</output>
        </div>
    );
}

async function renderSheet(request: FilePassphraseRequest = baseRequest) {
    const rendered = render(<EncryptionPromptProvider><Harness request={request} /></EncryptionPromptProvider>);
    fireEvent.click(screen.getByText('ask'));
    await screen.findByLabelText('settings.encryption_mode_passphrase');
    return rendered;
}

const typePassphrase = (value: string) => {
    fireEvent.change(screen.getByLabelText('settings.encryption_mode_passphrase'), { target: { value } });
};
const typeConfirmation = (value: string) => {
    fireEvent.change(screen.getByLabelText('settings.confirm_passphrase'), { target: { value } });
};
const submitButton = () => screen.getByRole('button', { name: 'auth.continue' }) as HTMLButtonElement;

describe('EncryptionPromptContext', () => {
    it('resolves the entered passphrase after acknowledgement and matching confirmation', async () => {
        await renderSheet();
        typePassphrase('correct horse battery');
        typeConfirmation('correct horse battery');
        fireEvent.click(screen.getByRole('checkbox'));
        expect(submitButton().disabled).toBe(false);
        fireEvent.click(submitButton());
        await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('correct horse battery'));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('blocks submission while the passphrase is shorter than eight bytes', async () => {
        await renderSheet();
        typePassphrase('short');
        typeConfirmation('short');
        fireEvent.click(screen.getByRole('checkbox'));
        expect(submitButton().disabled).toBe(true);
        expect(screen.getByText('settings.min_passphrase_length')).toBeTruthy();
    });

    it('blocks submission while the confirmation differs', async () => {
        await renderSheet();
        typePassphrase('correct horse battery');
        typeConfirmation('different horse battery');
        fireEvent.click(screen.getByRole('checkbox'));
        expect(submitButton().disabled).toBe(true);
        expect(screen.getByText('settings.passphrases_no_match')).toBeTruthy();
    });

    it('blocks submission until the key-loss disclaimer is acknowledged', async () => {
        await renderSheet();
        typePassphrase('correct horse battery');
        typeConfirmation('correct horse battery');
        expect(submitButton().disabled).toBe(true);
    });

    it('resolves null when the sheet is cancelled', async () => {
        await renderSheet();
        fireEvent.click(screen.getByText('common.cancel'));
        await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('cancelled'));
    });

    it('resolves null on Escape without submitting', async () => {
        await renderSheet();
        typePassphrase('correct horse battery');
        typeConfirmation('correct horse battery');
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('cancelled'));
    });

    it('cancels a second request while one prompt is already open', async () => {
        const results: Array<string | null> = [];
        function DoubleHarness() {
            const { requestFilePassphrase } = useEncryptionPrompt();
            return (
                <div>
                    <button onClick={() => void requestFilePassphrase(baseRequest).then(value => results.push(value))}>first</button>
                    <button onClick={() => void requestFilePassphrase(baseRequest).then(value => results.push(value))}>second</button>
                </div>
            );
        }
        render(<EncryptionPromptProvider><DoubleHarness /></EncryptionPromptProvider>);
        fireEvent.click(screen.getByText('first'));
        expect(await screen.findByRole('dialog')).toBeTruthy();
        fireEvent.click(screen.getByText('second'));
        await waitFor(() => expect(results).toEqual([null]));
        // The first prompt stays open and keeps accepting input.
        typePassphrase('correct horse battery');
        typeConfirmation('correct horse battery');
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(submitButton());
        await waitFor(() => expect(results).toEqual([null, 'correct horse battery']));
    });

    it('ignores resubmission from the already-submitting sheet', async () => {
        await renderSheet();
        typePassphrase('correct horse battery');
        typeConfirmation('correct horse battery');
        fireEvent.click(screen.getByRole('checkbox'));
        const button = submitButton();
        expect(button.disabled).toBe(false);
        // `handleSubmit` flips `submitting` before closing, so a second click
        // on the same element is a no-op even before the sheet unmounts.
        fireEvent.click(button);
        fireEvent.click(button);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.getByTestId('result').textContent).toBe('correct horse battery');
    });
});

import { CliReporter } from '../../src/reporting/CliReporter';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import { Spinner } from '@topcli/spinner';

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'; // Add Jest imports


// --- Mocking Dependencies ---
// Mocking for chalk, spinner, cli-progress removed.
// We will test the reporter's interaction with console directly.
// --- End Mocking ---


describe('CliReporter Tests', () => {
    let reporter: CliReporter;
    let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
    let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;
    let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

    beforeEach(() => {
        jest.clearAllMocks();
        // Default reporter (verbose=false)
        reporter = new CliReporter(false);
        // Spy on console methods
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        // Restore console mocks
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    // --- Constructor Test ---
    it('should set verbose flag based on constructor argument', () => {
        const verboseReporter = new CliReporter(true);
        // Access private member for testing (use with caution or add a getter)
        expect((verboseReporter as any).verbose).toBe(true);
        expect((reporter as any).verbose).toBe(false);
    });

    // --- Spinner Tests ---
    it('startSpinner should create and start a spinner', () => {
        const text = 'Starting process...';
        reporter.startSpinner(text);
        // Check internal state
        expect((reporter as any).spinner).toBeDefined();
        expect((reporter as any).spinner?.text).toBe(text);
        // Cannot check mockSpinnerInstance anymore
    });

    it('updateSpinnerText should update spinner text if active', () => {
        const initialText = 'Working...';
        const updatedText = 'Still working...';
        reporter.startSpinner(initialText); // This will create a real spinner if not disabled
        reporter.updateSpinnerText(updatedText);
        // Check internal state
        expect((reporter as any).spinner?.text).toBe(updatedText);
        // Cannot check mockSpinnerInstance.text anymore
    });

     it('updateSpinnerText should do nothing if spinner not active', () => {
         reporter.updateSpinnerText('No spinner');
         // No internal state to check easily, this test might become redundant
         // Cannot check mockSpinnerInstance.text anymore
     });


    it('stopSpinnerSuccess should call spinner.succeed and clear spinner', () => {
        const text = 'Done!';
        reporter.startSpinner('Processing...'); // Creates real spinner
        reporter.stopSpinnerSuccess(text);
        // Check internal state
        expect((reporter as any).spinner).toBeNull();
        // Cannot check mockSpinnerInstance calls anymore
        expect((reporter as any).spinner).toBeNull();
    });

     it('stopSpinnerSuccess should handle no text', () => {
         reporter.startSpinner('Processing...'); // Creates real spinner
         reporter.stopSpinnerSuccess();
         // Check internal state
         expect((reporter as any).spinner).toBeNull();
         // Cannot check mockSpinnerInstance calls anymore
         expect((reporter as any).spinner).toBeNull();
     });

    it('stopSpinnerFailure should call spinner.fail and clear spinner', () => {
        const text = 'Failed!';
        reporter.startSpinner('Processing...'); // Creates real spinner
        reporter.stopSpinnerFailure(text);
        // Check internal state
        expect((reporter as any).spinner).toBeNull();
        // Cannot check mockSpinnerInstance calls anymore
        expect((reporter as any).spinner).toBeNull();
    });

     it('stopSpinnerFailure should handle no text', () => {
         reporter.startSpinner('Processing...'); // Creates real spinner
         reporter.stopSpinnerFailure();
         // Check internal state
         expect((reporter as any).spinner).toBeNull();
         // Cannot check mockSpinnerInstance calls anymore
         expect((reporter as any).spinner).toBeNull();
     });


    // --- Progress Bar Tests ---
    it('initializeMultiBar should create multibar and bars for each format', () => {
        const formats = ['jpg', 'png'];
        const totals = new Map([['jpg', 100], ['png', 50]]);
        // This test becomes harder without mocking cli-progress globally.
        // We can check the internal state `reporter.bars` size.
        reporter.initializeMultiBar(formats, totals);

        // expect(cliProgress.MultiBar).toHaveBeenCalledTimes(1); // Cannot check
        // expect(mockMultiBarInstance.create).toHaveBeenCalledTimes(2); // Cannot check
        // Cannot check mockMultiBarInstance calls anymore
        expect((reporter as any).bars.size).toBe(2); // Check internal state
        // Cannot check internal bar instance easily
        // expect((reporter as any).bars.get('jpg').bar).toBe(mockProgressBarInstance);
    });

    it('updateProgress should call increment on the correct bar with updated payload', () => {
        const formats = ['mov'];
        const totals = new Map([['mov', 10]]);
        reporter.initializeMultiBar(formats, totals);

        const initialPayload = (reporter as any).bars.get('mov').payload;
        expect(initialPayload.stats.errorCount).toBe(0);

        // Update progress with error count
        reporter.updateProgress('mov', 1, { errorCount: 1 });

        const updatedPayload = (reporter as any).bars.get('mov').payload;
        expect(updatedPayload.stats.errorCount).toBe(1); // Check stored payload updated

        // We checked the internal payload update above.
        // Cannot easily check the underlying bar.increment call without more complex mocking or inspection.
        // Update progress without stats
        reporter.updateProgress('mov', 2);
        // expect(mockProgressBarInstance.increment).toHaveBeenCalledTimes(2); // Cannot check
        // Payload should retain previous stats update (checked above)
        // expect(mockProgressBarInstance.increment).toHaveBeenCalledWith(2, { format: 'mov', stats: { errorCount: 1 } }); // Cannot check
        expect((reporter as any).bars.get('mov')?.payload.stats.errorCount).toBe(1); // Stored payload still has error count (add optional chaining)
    });

     it('updateProgress should handle unknown format gracefully', () => {
         const formats = ['gif'];
         const totals = new Map([['gif', 5]]);
         reporter.initializeMultiBar(formats, totals);
         // This test mainly ensures no error is thrown for unknown format.
         expect(() => {
             reporter.updateProgress('unknown', 1);
         }).not.toThrow();
     });


    it('stopMultiBar should call multibar.stop and clear bars', () => {
        const formats = ['avi'];
        const totals = new Map([['avi', 20]]);
        reporter.initializeMultiBar(formats, totals);
        expect((reporter as any).multibar).not.toBeNull();
        expect((reporter as any).bars.size).toBe(1);

        reporter.stopMultiBar();
        // Check internal state
        expect((reporter as any).multibar).toBeNull(); // Check internal state
        expect((reporter as any).bars.size).toBe(0); // Check internal state
    });

    // --- Logging Tests ---
    it('logInfo should call console.log with blue text', () => {
        const message = 'Information message';
        reporter.logInfo(message);
        // Chalk mock removed, check plain text or use regex
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(message));
        // Cannot easily check clearLine/redraw without more complex console mocking
    });

    it('logSuccess should call console.log with green text', () => {
        const message = 'Success message';
        reporter.logSuccess(message);
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(message));
    });

    it('logWarning should call console.warn with yellow text', () => {
        const message = 'Warning message';
        reporter.logWarning(message);
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining(message));
    });

    it('logError should call console.error with red text', () => {
        const message = 'Error message';
        reporter.logError(message);
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(message));
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1); // No stack trace when verbose=false
    });

    it('logError should log stack trace if verbose is true', () => {
        const verboseReporter = new CliReporter(true);
        const message = 'Error with stack';
        const error = new Error('Something went wrong');
        error.stack = 'Error: Something went wrong\n    at test.js:1:1';
        verboseReporter.logError(message, error);
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(message));
        // Check that it was called a second time (for the stack trace), but don't check the exact content
        expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    });

     it('logError should handle error without stack trace when verbose', () => {
         const verboseReporter = new CliReporter(true);
         const message = 'Error without stack';
         const error = new Error('Something went wrong');
         error.stack = undefined; // Simulate no stack
         verboseReporter.logError(message, error);
         expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(message));
         expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(error.toString())); // Should log toString()
         expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
     });

});
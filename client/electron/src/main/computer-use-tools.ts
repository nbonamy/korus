import { product } from '@workspace/core/product';
import * as helper from 'multi-agents-sdk/computer-use';
export { isComputerUseCommand, stopComputerUseHelper } from 'multi-agents-sdk/computer-use';
export type ComputerUseOptions = Omit<helper.ComputerUseOptions, 'helperAppName'>;
const configured = (options: ComputerUseOptions): helper.ComputerUseOptions => ({ ...options, helperAppName: `${product.name} Computer Use.app` });
export function getComputerUseStatus(options: ComputerUseOptions) { return helper.getComputerUseStatus(configured(options)); }
export function requestComputerUseAccessibility(options: ComputerUseOptions) { return helper.requestComputerUseAccessibility(configured(options)); }
export function requestComputerUseScreenCapture(options: ComputerUseOptions) { return helper.requestComputerUseScreenCapture(configured(options)); }
export function executeComputerUseCommand(input: { command: helper.ComputerUseCommand; arguments: Record<string, unknown>; options: ComputerUseOptions }) { return helper.executeComputerUseCommand({ ...input, options: configured(input.options) }); }

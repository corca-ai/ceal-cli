import { renderPlainYamlDocument } from "./yaml.js";

interface TextStream {
	write(chunk: string): unknown;
}

export function writeHelp(help: string, io: { stdout: TextStream }): number {
	io.stdout.write(`${help}\n`);
	return 0;
}

export function writeYaml(stream: TextStream, value: unknown): 0 {
	stream.write(renderPlainYamlDocument(value));
	return 0;
}

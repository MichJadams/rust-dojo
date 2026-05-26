import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
	normalizePath,
	requestUrl,
} from "obsidian";

interface RustDojoSettings {
	apiKey: string;
	folderPath: string;
	autoOpen: boolean;
	projectWeek: number;
	projectDay: number;
	projectTheme: string;
}

const DEFAULT_SETTINGS: RustDojoSettings = {
	apiKey: "",
	folderPath: "Rust Dojo",
	autoOpen: true,
	projectWeek: 1,
	projectDay: 1,
	projectTheme: "",
};

const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const PLAYGROUND_BASE =
	"https://play.rust-lang.org/?version=stable&mode=debug&edition=2021&code=";

// 20-week project arc. Each project spans 5 days and folds in the concepts the
// daily curriculum covered that week. The "Advance Project Day" command walks
// this list when a week rolls over.
const PROJECT_THEMES: string[] = [
	"Bit Inspector — variables, types, formatting, bitwise operations",
	"Choose-Your-Adventure CLI — control flow, loops, tuples, arrays",
	"String Toolkit — functions, &str vs String, format!, string ownership",
	"Number Cruncher — arithmetic, parsing, slices, stdin",
	"Ownership Lab — move semantics, Copy vs Clone, passing values",
	"Borrow Checker Drills — &T vs &mut T, scope, multiple borrows",
	"Slice Inspector — lifetimes, slice patterns, &str borrowing",
	"Iterator Pipeline — map, filter, collect, for-iter chains",
	"Data Aggregator — fold, sum, zip, enumerate, simple statistics",
	"Closure Café — closures, captures, higher-order functions",
	"Geometry Kit — structs, methods, associated functions",
	"Pattern Matcher — enums, match, if let / while let",
	"Safe Parser — Option, Result, the ? operator",
	"Generic Toolbox — generic functions, structs, enums, defining traits",
	"Trait Showcase — bounds, derive macros, Display vs Debug",
	"Robust CLI — custom error types, From, error propagation",
	"Word Counter — Vec, HashMap, HashSet, iteration over collections",
	"Mini Grep — file I/O, BufRead, CLI argument parsing",
	"Concurrent Downloader — threads, channels, Mutex, Arc",
	"Smart Pointer Studio — Box, Rc, RefCell, Deref (capstone)",
];

// 20 weeks × 5 days = 100 days. Ordered for steady progression: basics → ownership
// → iterators/closures → structs/enums/pattern matching → traits → errors → I/O & CLI
// → concurrency. Each topic is narrow enough to support 20 two-minute exercises.
const DEFAULT_CURRICULUM: string[] = [
	// Week 1 — variables and basic scalar types
	"variables and let bindings",
	"mutability with mut",
	"shadowing and rebinding",
	"integer types and literals",
	"floating-point types and literals",
	// Week 2 — more types and control flow
	"booleans and char",
	"tuples",
	"fixed-size arrays",
	"if/else as expressions",
	"loop, while, and for loops",
	// Week 3 — functions and strings
	"functions and parameters",
	"return values, expressions vs statements",
	"string literals and &str basics",
	"the String type",
	"string formatting with format! and println!",
	// Week 4 — numeric ops, slices, stdin
	"arithmetic and integer overflow",
	"numeric casting with as",
	"string slices",
	"array and Vec slices",
	"reading from stdin",
	// Week 5 — ownership foundations
	"move semantics and the ownership rules",
	"Copy vs Clone",
	"ownership across function calls",
	"returning ownership from functions",
	"references and the & operator",
	// Week 6 — borrowing
	"mutable references",
	"the borrow checker rules",
	"multiple immutable borrows",
	"dangling references and why they fail",
	"borrowing in function signatures",
	// Week 7 — slices and lifetimes intro
	"string slice (&str) borrowing patterns",
	"slice mutation",
	"lifetime annotations basics",
	"lifetime elision rules",
	"the 'static lifetime",
	// Week 8 — iterators foundations
	"iter, into_iter, and iter_mut",
	"for loops over iterators",
	"Iterator::map",
	"Iterator::filter",
	"Iterator::collect",
	// Week 9 — more iterator methods
	"sum and product",
	"fold and reduce",
	"count, min, and max",
	"enumerate and zip",
	"take and skip",
	// Week 10 — closures
	"closure syntax",
	"closures capturing environment",
	"Fn, FnMut, and FnOnce",
	"closures as function arguments",
	"returning closures from functions",
	// Week 11 — structs
	"defining structs",
	"struct instantiation and field access",
	"methods with impl blocks",
	"associated functions (like new)",
	"tuple structs and unit structs",
	// Week 12 — enums and pattern matching
	"defining enums",
	"enums with data",
	"match expressions",
	"match guards and bindings",
	"if let and while let",
	// Week 13 — Option and Result
	"Option<T> basics",
	"unwrap, expect, and ? on Option",
	"Result<T, E> basics",
	"matching on Result",
	"mapping Option and Result",
	// Week 14 — generics and traits intro
	"generic functions",
	"generic structs",
	"generic enums",
	"defining a trait",
	"implementing a trait",
	// Week 15 — trait bounds and common traits
	"trait bounds and where clauses",
	"derive macros (Debug, Clone, Default)",
	"Display vs Debug formatting",
	"PartialEq, Eq, PartialOrd, Ord",
	"default trait methods",
	// Week 16 — error handling
	"panic! and assertions",
	"the ? operator with Result",
	"propagating errors across functions",
	"custom error types",
	"From trait for error conversion",
	// Week 17 — collections
	"Vec<T> basics",
	"Vec<T> mutation and methods",
	"HashMap basics",
	"HashMap iteration and the entry API",
	"HashSet basics",
	// Week 18 — file I/O and CLI
	"reading a file with std::fs",
	"writing a file with std::fs",
	"reading lines with BufRead",
	"command-line args with std::env::args",
	"parsing CLI arguments by hand",
	// Week 19 — concurrency foundations
	"spawning threads with std::thread",
	"join handles and joining threads",
	"message passing with mpsc channels",
	"shared state with Mutex",
	"Arc for shared ownership across threads",
	// Week 20 — smart pointers and capstone
	"Box<T> and heap allocation",
	"Rc<T> for shared ownership",
	"RefCell<T> and interior mutability",
	"the Deref trait",
	"capstone: small CLI tool combining several topics",
];

interface CurriculumEntry {
	day: number;
	topic: string;
	status: "pending" | "in-progress" | "complete";
	notes?: string;
	startLine: number;
	endLine: number;
}

interface Exercise {
	title: string;
	description: string;
	code: string;
}

interface AnkiCard {
	front: string;
	back: string;
	tags: string[];
}

interface ProjectContext {
	week: number;
	day: number;
	theme: string;
}

interface GenerationResult {
	conceptSummary: string;
	exercises: Exercise[];
	ankiCards: AnkiCard[];
}

export default class RustDojoPlugin extends Plugin {
	settings!: RustDojoSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addCommand({
			id: "generate-daily-exercises",
			name: "Generate Daily Exercises",
			callback: () => {
				void this.generateDailyExercises();
			},
		});

		this.addCommand({
			id: "advance-project-day",
			name: "Advance Project Day",
			callback: () => {
				void this.advanceProjectDay();
			},
		});

		this.registerMarkdownCodeBlockProcessor(
			"rust-dojo",
			(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				const widget = new RustDojoWidget(el, this);
				ctx.addChild(widget);
			},
		);

		this.addSettingTab(new RustDojoSettingTab(this.app, this));
	}

	onunload(): void {
		// nothing to clean up
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<RustDojoSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private curriculumPath(): string {
		return normalizePath(`${this.settings.folderPath}/curriculum.md`);
	}

	private dailyFolderPath(): string {
		return normalizePath(`${this.settings.folderPath}/Daily`);
	}

	dailyNotePath(date: string): string {
		return normalizePath(`${this.dailyFolderPath()}/${date}.md`);
	}

	private async ensureFolder(path: string): Promise<void> {
		const normalized = normalizePath(path);
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		if (existing) return;
		await this.app.vault.createFolder(normalized);
	}

	private async readOrCreateCurriculum(): Promise<string> {
		const path = this.curriculumPath();
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			return await this.app.vault.read(existing);
		}
		await this.ensureFolder(this.settings.folderPath);
		const initial = buildDefaultCurriculum();
		await this.app.vault.create(path, initial);
		return initial;
	}

	private parseCurriculum(content: string): CurriculumEntry[] {
		const lines = content.split(/\r?\n/);
		const entries: CurriculumEntry[] = [];
		const dayHeader = /^##\s+Day\s+(\d+)\s*$/i;

		let current: Partial<CurriculumEntry> | null = null;
		let currentStart = -1;

		const flush = (endLineExclusive: number) => {
			if (current && current.day !== undefined) {
				entries.push({
					day: current.day,
					topic: current.topic ?? "",
					status:
						(current.status as CurriculumEntry["status"]) ?? "pending",
					notes: current.notes,
					startLine: currentStart,
					endLine: endLineExclusive,
				});
			}
			current = null;
			currentStart = -1;
		};

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const match = line.match(dayHeader);
			if (match) {
				flush(i);
				current = { day: parseInt(match[1], 10) };
				currentStart = i;
				continue;
			}
			if (!current) continue;
			const kv = line.match(/^\s*-\s*([a-zA-Z]+)\s*:\s*(.*)$/);
			if (!kv) continue;
			const key = kv[1].toLowerCase();
			const value = kv[2].trim();
			if (key === "topic") current.topic = value;
			else if (key === "status") current.status = value as CurriculumEntry["status"];
			else if (key === "notes") current.notes = value;
		}
		flush(lines.length);

		entries.sort((a, b) => a.day - b.day);
		return entries;
	}

	private findNextEntry(entries: CurriculumEntry[]): CurriculumEntry | null {
		// Prefer in-progress so a re-run continues the same day. Then first pending.
		const inProgress = entries.find((e) => e.status === "in-progress");
		if (inProgress) return inProgress;
		const pending = entries.find((e) => e.status === "pending");
		return pending ?? null;
	}

	private async updateCurriculumStatus(
		day: number,
		status: CurriculumEntry["status"],
	): Promise<void> {
		const path = this.curriculumPath();
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const content = await this.app.vault.read(file);
		const lines = content.split(/\r?\n/);
		const header = new RegExp(`^##\\s+Day\\s+${day}\\s*$`, "i");

		let inSection = false;
		let statusReplaced = false;
		for (let i = 0; i < lines.length; i++) {
			if (header.test(lines[i])) {
				inSection = true;
				continue;
			}
			if (inSection && /^##\s+Day\s+\d+/i.test(lines[i])) {
				break;
			}
			if (inSection && /^\s*-\s*status\s*:/i.test(lines[i])) {
				lines[i] = `- status: ${status}`;
				statusReplaced = true;
				break;
			}
		}

		if (!statusReplaced) return;
		await this.app.vault.modify(file, lines.join("\n"));
	}

	resolveProjectContext(curriculumContent: string): ProjectContext | null {
		const fromFile = parseCurriculumContext(curriculumContent);
		const week = fromFile.week ?? this.settings.projectWeek;
		const day = fromFile.day ?? this.settings.projectDay;
		const theme = fromFile.theme ?? this.settings.projectTheme;
		if (!theme || !theme.trim()) return null;
		return { week, day, theme };
	}

	async syncProjectContextToCurriculum(
		patch: Partial<ProjectContext>,
	): Promise<void> {
		const path = this.curriculumPath();
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const content = await this.app.vault.read(file);
		const updated = upsertProjectContextInCurriculum(content, patch);
		if (updated !== content) {
			await this.app.vault.modify(file, updated);
		}
	}

	async advanceProjectDay(): Promise<void> {
		try {
			const curriculumContent = await this.readOrCreateCurriculum();
			const fromFile = parseCurriculumContext(curriculumContent);
			const currentWeek = fromFile.week ?? this.settings.projectWeek;
			const currentDay = fromFile.day ?? this.settings.projectDay;

			let newWeek = currentWeek;
			let newDay = currentDay + 1;
			let newTheme =
				fromFile.theme ?? this.settings.projectTheme ?? "";

			if (newDay > 5) {
				newWeek += 1;
				newDay = 1;
				if (newWeek > PROJECT_THEMES.length) {
					new Notice(
						`Rust Dojo: project curriculum complete after ${PROJECT_THEMES.length} weeks. 🎉`,
					);
					return;
				}
				newTheme = PROJECT_THEMES[newWeek - 1];
			}

			const file = this.app.vault.getAbstractFileByPath(
				this.curriculumPath(),
			);
			if (file instanceof TFile) {
				const updated = upsertProjectContextInCurriculum(curriculumContent, {
					week: newWeek,
					day: newDay,
					theme: newTheme,
				});
				if (updated !== curriculumContent) {
					await this.app.vault.modify(file, updated);
				}
			}

			this.settings.projectWeek = newWeek;
			this.settings.projectDay = newDay;
			this.settings.projectTheme = newTheme;
			await this.saveSettings();

			new Notice(
				`Advanced to Week ${newWeek}, Day ${newDay}: ${newTheme}`,
			);
		} catch (err) {
			console.error("Rust Dojo advance error:", err);
			new Notice(`Rust Dojo: ${(err as Error).message}`, 10000);
		}
	}

	private async callAnthropic(
		topic: string,
		day: number,
		context: ProjectContext | null,
	): Promise<GenerationResult> {
		if (!this.settings.apiKey) {
			throw new Error("Anthropic API key is not set in plugin settings.");
		}

		const userPrompt = buildPrompt(topic, day, context);

		const body = {
			model: ANTHROPIC_MODEL,
			max_tokens: 12000,
			messages: [{ role: "user", content: userPrompt }],
		};

		const response = await requestUrl({
			url: ANTHROPIC_URL,
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": this.settings.apiKey,
				"anthropic-version": "2023-06-01",
				"anthropic-dangerous-direct-browser-ipc": "true",
			},
			body: JSON.stringify(body),
			throw: false,
		});

		if (response.status < 200 || response.status >= 300) {
			throw new Error(
				`Anthropic API error ${response.status}: ${response.text}`,
			);
		}

		const json = response.json as {
			content?: Array<{ type: string; text?: string }>;
		};
		const textBlock = json.content?.find((b) => b.type === "text");
		const raw = textBlock?.text ?? "";
		if (!raw) {
			throw new Error("Anthropic response contained no text content.");
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(stripPossibleFences(raw));
		} catch (err) {
			throw new Error(
				`Failed to parse model output as JSON: ${(err as Error).message}\n\nRaw output:\n${raw.slice(0, 500)}`,
			);
		}

		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new Error("Model output was not a JSON object.");
		}

		const obj = parsed as Record<string, unknown>;

		const exercises: Exercise[] = Array.isArray(obj.exercises)
			? obj.exercises.map((item, idx) => {
					const o = (item ?? {}) as Record<string, unknown>;
					return {
						title:
							typeof o.title === "string" ? o.title : `Exercise ${idx + 1}`,
						description:
							typeof o.description === "string" ? o.description : "",
						code: typeof o.code === "string" ? o.code : "",
					};
				})
			: [];

		if (exercises.length === 0) {
			throw new Error("Model returned no exercises.");
		}

		const conceptSummary =
			typeof obj.concept_summary === "string"
				? obj.concept_summary.trim()
				: "";

		const ankiCards: AnkiCard[] = Array.isArray(obj.anki_cards)
			? obj.anki_cards
					.map((item) => {
						const o = (item ?? {}) as Record<string, unknown>;
						const tags = Array.isArray(o.tags)
							? (o.tags.filter((t) => typeof t === "string") as string[])
							: [];
						return {
							front: typeof o.front === "string" ? o.front.trim() : "",
							back: typeof o.back === "string" ? o.back.trim() : "",
							tags,
						};
					})
					.filter((c) => c.front && c.back)
			: [];

		return { conceptSummary, exercises, ankiCards };
	}

	private buildDailyNote(
		day: number,
		topic: string,
		result: GenerationResult,
	): string {
		const lines: string[] = [];
		lines.push(`# Rust Dojo — Day ${day}: ${topic}`);
		lines.push("");

		lines.push("## Today's Concepts");
		lines.push("");
		lines.push(
			result.conceptSummary || "_Concept summary was not generated._",
		);
		lines.push("");
		lines.push("---");
		lines.push("");

		lines.push(`## Exercises (0 / ${result.exercises.length} complete)`);
		lines.push("");
		result.exercises.forEach((ex, idx) => {
			const playgroundCode = buildPlaygroundCode(ex, idx + 1, day, topic);
			const link = PLAYGROUND_BASE + encodeForMarkdownUrl(playgroundCode);
			lines.push(
				`- [ ] **Exercise ${idx + 1}: ${ex.title}** — ${ex.description} → [▶ Open in Playground](${link})`,
			);
		});
		lines.push("");
		lines.push("---");
		lines.push("");

		lines.push("## Anki Cards");
		lines.push("");
		if (result.ankiCards.length === 0) {
			lines.push("_Anki cards were not generated._");
		} else {
			const dayTag = `day-${String(day).padStart(2, "0")}`;
			result.ankiCards.forEach((card) => {
				const tagSet = new Set<string>();
				tagSet.add("rust-dojo");
				tagSet.add(dayTag);
				for (const t of card.tags) {
					const cleaned = t.trim().toLowerCase().replace(/\s+/g, "-");
					if (cleaned) tagSet.add(cleaned);
				}
				lines.push("START");
				lines.push("Basic");
				lines.push(`Front: ${card.front}`);
				lines.push(`Back: ${card.back}`);
				lines.push(`Tags: ${Array.from(tagSet).join(" ")}`);
				lines.push("END");
				lines.push("");
			});
		}
		lines.push("---");
		lines.push("");

		lines.push("## Notes");
		lines.push("");
		return lines.join("\n");
	}

	async generateDailyExercises(): Promise<void> {
		try {
			const curriculumContent = await this.readOrCreateCurriculum();
			const entries = this.parseCurriculum(curriculumContent);
			if (entries.length === 0) {
				new Notice("Rust Dojo: curriculum has no days. Check curriculum.md.");
				return;
			}

			const next = this.findNextEntry(entries);
			if (!next) {
				new Notice("Rust Dojo: every curriculum day is complete. 🎉");
				return;
			}
			if (!next.topic) {
				new Notice(`Rust Dojo: Day ${next.day} has no topic set.`);
				return;
			}

			const context = this.resolveProjectContext(curriculumContent);

			const notice = new Notice(
				`Generating Day ${next.day} exercises…`,
				0,
			);

			let result: GenerationResult;
			try {
				result = await this.callAnthropic(next.topic, next.day, context);
			} catch (err) {
				notice.hide();
				const msg = (err as Error).message;
				new Notice(`Rust Dojo: generation failed — ${msg}`, 10000);
				console.error("Rust Dojo generation error:", err);
				return;
			}

			const today = localDateString();
			await this.ensureFolder(this.dailyFolderPath());
			const notePath = this.dailyNotePath(today);
			const noteContent = this.buildDailyNote(next.day, next.topic, result);

			const existing = this.app.vault.getAbstractFileByPath(notePath);
			let file: TFile;
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, noteContent);
				file = existing;
			} else {
				file = await this.app.vault.create(notePath, noteContent);
			}

			await this.updateCurriculumStatus(next.day, "in-progress");

			notice.hide();
			new Notice(
				`Rust Dojo: Day ${next.day} ready (${result.exercises.length} exercises, ${result.ankiCards.length} cards).`,
			);
			if (!result.conceptSummary || result.ankiCards.length === 0) {
				new Notice(
					"Rust Dojo: Some sections may be incomplete — check the daily note.",
					8000,
				);
			}

			if (this.settings.autoOpen) {
				const leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(file);
			}
		} catch (err) {
			console.error("Rust Dojo unexpected error:", err);
			new Notice(`Rust Dojo: ${(err as Error).message}`, 10000);
		}
	}
}

function buildDefaultCurriculum(): string {
	const lines: string[] = [];
	lines.push("# Rust Dojo Curriculum");
	lines.push("");
	lines.push(
		"Source of truth for the daily progression. Edit topics or statuses as needed.",
	);
	lines.push("Valid statuses: `pending`, `in-progress`, `complete`.");
	lines.push("");
	lines.push("current-project-week: 1");
	lines.push("current-project-day: 1");
	lines.push(`current-project-theme: ${PROJECT_THEMES[0]}`);
	lines.push("");
	DEFAULT_CURRICULUM.forEach((topic, idx) => {
		const day = idx + 1;
		lines.push(`## Day ${day}`);
		lines.push(`- topic: ${topic}`);
		lines.push(`- status: pending`);
		lines.push("");
	});
	return lines.join("\n");
}

function parseCurriculumContext(content: string): Partial<ProjectContext> {
	const ctx: Partial<ProjectContext> = {};
	const lines = content.split(/\r?\n/);
	for (const line of lines) {
		if (/^##\s+Day\s+\d+/i.test(line)) break;
		const m = line.match(/^current-project-(week|day|theme)\s*:\s*(.*)$/i);
		if (!m) continue;
		const key = m[1].toLowerCase();
		const value = m[2].trim();
		if (key === "week") {
			const n = parseInt(value, 10);
			if (!isNaN(n)) ctx.week = n;
		} else if (key === "day") {
			const n = parseInt(value, 10);
			if (!isNaN(n)) ctx.day = n;
		} else if (key === "theme") {
			if (value) ctx.theme = value;
		}
	}
	return ctx;
}

function upsertProjectContextInCurriculum(
	content: string,
	patch: Partial<ProjectContext>,
): string {
	const lines = content.split(/\r?\n/);
	const entries: Array<["week" | "day" | "theme", string]> = [];
	if (patch.week !== undefined) entries.push(["week", String(patch.week)]);
	if (patch.day !== undefined) entries.push(["day", String(patch.day)]);
	if (patch.theme !== undefined) entries.push(["theme", patch.theme]);
	if (entries.length === 0) return content;

	const handled = new Set<string>();
	for (let i = 0; i < lines.length; i++) {
		if (/^##\s+Day\s+\d+/i.test(lines[i])) break;
		for (const [key, value] of entries) {
			if (handled.has(key)) continue;
			const re = new RegExp(
				`^current-project-${key}\\s*:\\s*.*$`,
				"i",
			);
			if (re.test(lines[i])) {
				lines[i] = `current-project-${key}: ${value}`;
				handled.add(key);
			}
		}
	}

	const toInsert: string[] = [];
	for (const [key, value] of entries) {
		if (!handled.has(key)) toInsert.push(`current-project-${key}: ${value}`);
	}
	if (toInsert.length > 0) {
		const dayLineIdx = lines.findIndex((l) => /^##\s+Day\s+\d+/i.test(l));
		const insertAt = dayLineIdx === -1 ? lines.length : dayLineIdx;
		lines.splice(insertAt, 0, ...toInsert, "");
	}

	return lines.join("\n");
}

function stripPossibleFences(text: string): string {
	const trimmed = text.trim();
	const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
	if (fence) return fence[1].trim();
	return trimmed;
}

function buildPrompt(
	topic: string,
	day: number,
	context: ProjectContext | null,
): string {
	const projectBlock = context
		? `Weekly project context — Week ${context.week}, Day ${context.day}: ${context.theme}
The learner is building this small project across 5 days. Mention it where natural in the concept summary, and use it to inform a few of the flashcards.`
		: `No weekly project context is set. Focus the concept summary and all 10 Anki cards on the daily topic only.`;

	const projectCardLine = context
		? `~4 cards should relate to the weekly project — Week ${context.week}, Day ${context.day}: "${context.theme}". Focus on concepts the learner will hit at the current project checkpoint, or concepts from the previous day worth retaining.`
		: `All 10 cards focus on today's topic since no project context is set.`;

	return `You are generating Day ${day} of a beginner Rust curriculum.

Today's topic: **${topic}**

${projectBlock}

Produce THREE things in a single JSON object:

1. **concept_summary** — 2 to 3 paragraphs (~200 words total) refreshing the key Rust concepts for today's topic. Written as a refresher for someone who has already touched the topic, NOT a textbook intro. Connect to the weekly project where natural.

2. **exercises** — exactly 20 small Rust exercises focused on the daily topic:
   a. Each exercise is a self-contained Rust snippet with a stub the learner must complete (function body = \`todo!()\` or an obvious placeholder) AND a \`fn main()\` that calls the stub with concrete inputs, asserts behavior using \`assert_eq!\` / \`assert!\`, and prints "All checks passed!" on success.
   b. Use \`fn main()\` — NOT \`#[test]\`. The Rust Playground's RUN button executes \`cargo run\`, which compiles out \`#[test]\` functions. We need the checks to run on a single click of RUN.
   c. Each completable in ~2 minutes by a beginner. Vary the shape across the 20. Snippets 8 to 20 lines. Standard library only — no external crates.
   d. Do NOT include a header comment describing the exercise — the harness adds one.

3. **anki_cards** — exactly 10 flashcards testing CONCEPTUAL UNDERSTANDING, not syntax recall. The exercises already drill syntax; the cards should test "why" and "when."

   Good: "Why does Rust distinguish between String and &str?"
   Bad: "What keyword declares a variable in Rust?"

   Good: "You have a Vec<String> and want to iterate without consuming it. What method do you call?"
   Bad: "Write the syntax for a for loop."

   Each card object: \`front\` (question), \`back\` (1 to 3 sentence answer; include a short code snippet only when it clarifies the concept), and \`tags\` (array of lowercase, hyphenated topic labels, e.g. ["ownership", "borrowing"]).

   ~6 cards should reinforce today's topic — "${topic}" — conceptually.
   ${projectCardLine}

Return ONLY a raw JSON object. No markdown fences. No preamble. No commentary. Shape:

{
  "concept_summary": "paragraph 1\\n\\nparagraph 2\\n\\nparagraph 3",
  "exercises": [
    {"title": "Add two numbers", "description": "Implement add so the assertions pass.", "code": "fn add(a: i32, b: i32) -> i32 {\\n    todo!()\\n}\\n\\nfn main() {\\n    assert_eq!(add(2, 3), 5);\\n    println!(\\"All checks passed!\\");\\n}"}
  ],
  "anki_cards": [
    {"front": "Why does Rust distinguish between String and &str?", "back": "String owns its data on the heap; &str is a borrowed view. The distinction lets functions accept any string slice without taking ownership.", "tags": ["strings", "ownership"]}
  ]
}

Output now:`;
}

// encodeURIComponent leaves "(", ")", "!", "'", "*" unencoded. In a markdown
// link the parser ends the URL at the first unmatched ")", so a raw ")"
// anywhere in the encoded payload (e.g. inside todo!()) truncates the link.
// Encode them explicitly.
function encodeForMarkdownUrl(s: string): string {
	return encodeURIComponent(s)
		.replace(/\(/g, "%28")
		.replace(/\)/g, "%29")
		.replace(/\*/g, "%2A")
		.replace(/'/g, "%27")
		.replace(/!/g, "%21");
}

function buildPlaygroundCode(
	ex: Exercise,
	exerciseNumber: number,
	day: number,
	topic: string,
): string {
	const header = [
		`// Rust Dojo — Day ${day}: ${topic}`,
		`// Exercise ${exerciseNumber}: ${ex.title}`,
		`//`,
		`// ${ex.description}`,
		`//`,
		`// Click RUN. The stub panics on todo!() until you implement it.`,
		`// When the assertions pass you'll see: All checks passed!`,
		``,
		``,
	].join("\n");
	return header + ex.code;
}

function localDateString(d: Date = new Date()): string {
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function formatStopwatch(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

interface ParsedExercise {
	number: number;
	title: string;
	description: string;
	link: string;
	done: boolean;
}

interface ParsedDailyNote {
	title: string;
	exercises: ParsedExercise[];
}

const EXERCISE_LINE =
	/^-\s+\[( |x|X)\]\s+\*\*Exercise\s+(\d+):\s+(.+?)\*\*\s+—\s+(.+?)\s+→\s+\[▶ Open in Playground\]\((.+?)\)\s*$/;

function parseDailyNote(content: string): ParsedDailyNote {
	const lines = content.split(/\r?\n/);
	let title = "Rust Dojo";
	const titleMatch = lines[0]?.match(/^#\s+(.+)$/);
	if (titleMatch) title = titleMatch[1].trim();

	const exercises: ParsedExercise[] = [];
	for (const line of lines) {
		const m = line.match(EXERCISE_LINE);
		if (!m) continue;
		exercises.push({
			number: parseInt(m[2], 10),
			title: m[3],
			description: m[4],
			link: m[5],
			done: m[1].toLowerCase() === "x",
		});
	}
	return { title, exercises };
}

function updateChecklistItem(
	content: string,
	exerciseNumber: number,
	done: boolean,
): string {
	const lines = content.split(/\r?\n/);
	let total = 0;
	let doneCount = 0;
	let touched = false;

	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(EXERCISE_LINE);
		if (!m) continue;
		total++;
		const num = parseInt(m[2], 10);
		let isDone = m[1].toLowerCase() === "x";
		if (num === exerciseNumber && isDone !== done) {
			const newChar = done ? "x" : " ";
			lines[i] = lines[i].replace(/^-\s+\[[ xX]\]/, `- [${newChar}]`);
			isDone = done;
			touched = true;
		}
		if (isDone) doneCount++;
	}

	if (!touched) return content;

	for (let i = 0; i < lines.length; i++) {
		if (
			/^##\s+Exercises\s+\(\d+\s+\/\s+\d+\s+complete\)\s*$/.test(lines[i])
		) {
			lines[i] = `## Exercises (${doneCount} / ${total} complete)`;
			break;
		}
		// Backwards-compat with the old "**Progress:**" format.
		if (/^\*\*Progress:\*\*\s+\d+\s+\/\s+\d+\s+complete\s*$/.test(lines[i])) {
			lines[i] = `**Progress:** ${doneCount} / ${total} complete`;
			break;
		}
	}

	return lines.join("\n");
}

class RustDojoWidget extends MarkdownRenderChild {
	private plugin: RustDojoPlugin;
	private intervalId: number | null = null;
	private runningSince: number | null = null;
	private accumulatedMs = 0;
	private displayEl!: HTMLElement;
	private toggleBtn!: HTMLButtonElement;
	private resetBtn!: HTMLButtonElement;
	private headerEl!: HTMLElement;
	private progressEl!: HTMLElement;
	private listEl!: HTMLElement;
	private notePath = "";

	constructor(containerEl: HTMLElement, plugin: RustDojoPlugin) {
		super(containerEl);
		this.plugin = plugin;
	}

	onload(): void {
		this.containerEl.empty();
		this.containerEl.addClass("rust-dojo-widget");

		this.headerEl = this.containerEl.createDiv({ cls: "rust-dojo-header" });

		const sw = this.containerEl.createDiv({ cls: "rust-dojo-stopwatch" });
		this.displayEl = sw.createDiv({
			cls: "rust-dojo-display",
			text: "00:00:00",
		});
		const btnRow = sw.createDiv({ cls: "rust-dojo-buttons" });
		this.toggleBtn = btnRow.createEl("button", {
			cls: "rust-dojo-btn rust-dojo-btn-start",
			text: "Start",
		});
		this.resetBtn = btnRow.createEl("button", {
			cls: "rust-dojo-btn rust-dojo-btn-reset",
			text: "Reset",
		});
		this.toggleBtn.addEventListener("click", () => this.toggleStopwatch());
		this.resetBtn.addEventListener("click", () => this.resetStopwatch());

		this.progressEl = this.containerEl.createDiv({ cls: "rust-dojo-progress" });
		this.listEl = this.containerEl.createEl("ul", {
			cls: "rust-dojo-exercise-list",
		});

		void this.refresh();

		this.registerEvent(
			this.plugin.app.vault.on("modify", (file: TAbstractFile) => {
				if (file.path === this.notePath) void this.refresh();
			}),
		);
	}

	onunload(): void {
		this.stopInterval();
	}

	private toggleStopwatch(): void {
		if (this.intervalId !== null) {
			if (this.runningSince !== null) {
				this.accumulatedMs += Date.now() - this.runningSince;
			}
			this.runningSince = null;
			this.stopInterval();
			this.toggleBtn.setText("Resume");
			this.toggleBtn.removeClass("rust-dojo-btn-running");
		} else {
			this.runningSince = Date.now();
			this.intervalId = window.setInterval(() => this.tick(), 250);
			this.toggleBtn.setText("Pause");
			this.toggleBtn.addClass("rust-dojo-btn-running");
			this.tick();
		}
	}

	private resetStopwatch(): void {
		this.stopInterval();
		this.runningSince = null;
		this.accumulatedMs = 0;
		this.displayEl.setText("00:00:00");
		this.toggleBtn.setText("Start");
		this.toggleBtn.removeClass("rust-dojo-btn-running");
	}

	private tick(): void {
		const live = this.runningSince ? Date.now() - this.runningSince : 0;
		this.displayEl.setText(formatStopwatch(this.accumulatedMs + live));
	}

	private stopInterval(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	private async refresh(): Promise<void> {
		const today = localDateString();
		this.notePath = this.plugin.dailyNotePath(today);
		const file = this.plugin.app.vault.getAbstractFileByPath(this.notePath);

		this.headerEl.empty();
		this.listEl.empty();
		this.progressEl.empty();

		if (!(file instanceof TFile)) {
			this.headerEl.createDiv({
				cls: "rust-dojo-empty",
				text: "No Rust Dojo exercises for today.",
			});
			this.headerEl.createDiv({
				cls: "rust-dojo-empty-hint",
				text: 'Run "Rust Dojo: Generate Daily Exercises" from the command palette to create them.',
			});
			return;
		}

		const content = await this.plugin.app.vault.read(file);
		const parsed = parseDailyNote(content);

		this.headerEl.createDiv({
			cls: "rust-dojo-title",
			text: parsed.title,
		});

		const done = parsed.exercises.filter((e) => e.done).length;
		const total = parsed.exercises.length;
		this.progressEl.setText(`${done} / ${total} complete`);

		for (const ex of parsed.exercises) {
			const li = this.listEl.createEl("li", { cls: "rust-dojo-exercise" });
			if (ex.done) li.addClass("rust-dojo-exercise-done");

			const checkbox = li.createEl("input", {
				cls: "rust-dojo-checkbox",
			});
			checkbox.type = "checkbox";
			checkbox.checked = ex.done;
			checkbox.addEventListener("change", () => {
				void this.toggleExercise(ex.number, checkbox.checked);
			});

			const label = li.createSpan({
				cls: "rust-dojo-exercise-label",
				text: `${ex.number}. ${ex.title}`,
			});
			label.setAttribute("title", ex.description);

			const link = li.createEl("a", {
				cls: "rust-dojo-exercise-link",
				href: ex.link,
				text: "▶",
			});
			link.setAttribute("target", "_blank");
			link.setAttribute("rel", "noopener");
			link.setAttribute("aria-label", "Open in Rust Playground");
		}
	}

	private async toggleExercise(num: number, done: boolean): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.notePath);
		if (!(file instanceof TFile)) return;
		const content = await this.plugin.app.vault.read(file);
		const updated = updateChecklistItem(content, num, done);
		if (updated !== content) {
			await this.plugin.app.vault.modify(file, updated);
		}
	}
}

class RustDojoSettingTab extends PluginSettingTab {
	plugin: RustDojoPlugin;

	constructor(app: App, plugin: RustDojoPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const intro = containerEl.createEl("div", { cls: "rust-dojo-intro" });
		intro.createEl("h3", { text: "Commands" });
		intro.createEl("p", {
			text: "Open the command palette (Ctrl/Cmd+P) and run any of these.",
		});

		const list = intro.createEl("ul");
		const commands: Array<{ name: string; desc: string }> = [
			{
				name: "Rust Dojo: Generate Daily Exercises",
				desc: "Reads curriculum.md, picks the next pending day, generates a concept summary, 20 exercises, and 10 Anki cards, writes today's daily note, and marks the day in-progress.",
			},
			{
				name: "Rust Dojo: Advance Project Day",
				desc: "Increments the weekly project day in curriculum.md. Rolls over to the next week's theme on day 6.",
			},
		];
		for (const cmd of commands) {
			const li = list.createEl("li");
			li.createEl("code", { text: cmd.name });
			li.appendText(" — " + cmd.desc);
		}

		intro.createEl("h3", { text: "Embed in a daily-notes template" });
		intro.createEl("p", {
			text: "Drop this fenced code block anywhere in a note (a daily-notes template works well) to render an interactive practice widget: a stopwatch with Start/Pause/Reset and a compact, toggleable checklist of today's exercises.",
		});
		const embedPre = intro.createEl("pre");
		embedPre.createEl("code", { text: "```rust-dojo\n```" });
		intro.createEl("p", {
			cls: "setting-item-description",
			text: "The widget reads today's daily note at <folder>/Daily/YYYY-MM-DD.md. If today's note doesn't exist yet, the widget shows a hint pointing to the Generate command.",
		});

		intro.createEl("p", {
			text: "To mark a day complete, edit curriculum.md and change that day's status to `complete`. The next run will move on to the following day.",
		});

		new Setting(containerEl)
			.setName("Anthropic API key")
			.setDesc(
				"Stored in plugin data on disk, not in the vault. Used to call the Claude API.",
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("sk-ant-…")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Vault folder")
			.setDesc(
				"Folder for the curriculum and daily notes (relative to the vault root).",
			)
			.addText((text) =>
				text
					.setPlaceholder("Rust Dojo")
					.setValue(this.plugin.settings.folderPath)
					.onChange(async (value) => {
						const v = value.trim().replace(/^\/+|\/+$/g, "");
						this.plugin.settings.folderPath = v.length > 0 ? v : "Rust Dojo";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-open generated note")
			.setDesc("Open the new daily note in the current pane after generation.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoOpen)
					.onChange(async (value) => {
						this.plugin.settings.autoOpen = value;
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h3", { text: "Weekly Project Context" });
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Used to bias ~4 of the daily Anki cards toward the project you're building this week. curriculum.md is the source of truth; these fields are the fallback when curriculum.md doesn't set them. Changes here also write through to curriculum.md if it exists.",
		});

		new Setting(containerEl)
			.setName("Current project week")
			.setDesc("Week 1–20.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.max = String(PROJECT_THEMES.length);
				text
					.setValue(String(this.plugin.settings.projectWeek))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n >= 1) {
							this.plugin.settings.projectWeek = n;
							await this.plugin.saveSettings();
							await this.plugin.syncProjectContextToCurriculum({ week: n });
						}
					});
			});

		new Setting(containerEl)
			.setName("Current project day")
			.setDesc("Day 1–5 within the current project week.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.inputEl.max = "5";
				text
					.setValue(String(this.plugin.settings.projectDay))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n >= 1 && n <= 5) {
							this.plugin.settings.projectDay = n;
							await this.plugin.saveSettings();
							await this.plugin.syncProjectContextToCurriculum({ day: n });
						}
					});
			});

		new Setting(containerEl)
			.setName("Current project theme")
			.setDesc(
				'A short name and concept list, e.g. "Bit Inspector — variables, types, formatting, bitwise operations". Leave blank to skip project-related Anki cards.',
			)
			.addText((text) =>
				text
					.setPlaceholder("ProjectName — concept, concept, concept")
					.setValue(this.plugin.settings.projectTheme)
					.onChange(async (value) => {
						const v = value.trim();
						this.plugin.settings.projectTheme = v;
						await this.plugin.saveSettings();
						await this.plugin.syncProjectContextToCurriculum({ theme: v });
					}),
			);
	}
}

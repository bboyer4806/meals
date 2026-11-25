<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto } from '$app/navigation';
	import { returnOnClick } from '#lib/return-to.ts';
	import type { Duplicate, DuplicateChoice } from '#lib/server/recipe-import.ts';
	import { UNREACHABLE, WENT_WRONG } from '#lib/submit.ts';

	// Import recipes (design 7). The chosen file stays in the form, so after the duplicate
	// choices it's sent again with them. Nothing is kept on the server in between. After problems
	// with the file, the fixed file is chosen again (MEA-129).

	/**
	 * The import's answer: its problems, the duplicates to choose for, or what it imported. For an
	 * import that got an error, `error` says why it wasn't done.
	 */
	type Outcome = {
		problems?: string[];
		duplicates?: Duplicate[];
		summary?: string;
		error?: string;
	};

	const CHANGED = 'The file changed after you chose it. Choose it again.';

	let outcome = $state<Outcome | null>(null);
	let choices = $state<Record<number, DuplicateChoice>>({});
	let names = $state<Record<number, string>>({});
	let importing = $state(false);
	let messageElement = $state<HTMLElement>();
	let fileInput: HTMLInputElement;

	// Sending the file again needs the page's script, so Import waits for it.
	let ready = $state(false);
	onMount(() => (ready = true));

	async function show(next: Outcome) {
		outcome = next;
		for (const duplicate of next.duplicates ?? []) {
			choices[duplicate.row] = duplicate.choice;
			names[duplicate.row] = duplicate.rename;
		}
		await tick();
		messageElement?.focus();
	}

	/**
	 * Whether the file can still be read. Chromium can't read one that changed after it was
	 * chosen, as when it was fixed and saved over (MEA-129).
	 */
	async function readable(file: File): Promise<boolean> {
		try {
			await file.slice(0, 1).arrayBuffer();
			return true;
		} catch (error) {
			// What reading throws for a file that changed or went after it was chosen.
			if (error instanceof DOMException) return false;
			throw error;
		}
	}

	/**
	 * Why an import that got an error wasn't done (6.11). An error with a status is one Meals
	 * answered with. Without an answer, the connection dropped, or Chromium wouldn't send the
	 * file: once it has sent a file, it won't send it again after it changes, and the request
	 * fails as if the connection had dropped (MEA-129).
	 */
	async function errorMessage(status: number | undefined, file: File): Promise<string> {
		if (status !== undefined) return WENT_WRONG;
		return (await readable(file)) ? UNREACHABLE : CHANGED;
	}

	const submit: SubmitFunction<Outcome, Outcome> = ({ cancel }) => {
		if (importing) return cancel();
		importing = true;
		return async ({ formData, result, update }) => {
			if (result.type === 'redirect') return update();
			if (result.type === 'success' && result.data?.summary !== undefined) {
				// Recipes says what was imported. It goes as navigation state, not in the address,
				// so a link can't make Recipes say something else, and a file with hundreds of
				// extra columns doesn't make the address too long (MEA-81). refreshAll drops a
				// preload of Recipes from before the import, such as from hovering Cancel.
				return goto('/recipes', {
					state: { importSummary: result.data.summary },
					refreshAll: true
				});
			}
			const next: Outcome =
				result.type === 'error'
					? { error: await errorMessage(result.status, formData.get('file') as File) }
					: (result.data as Outcome);
			importing = false;
			// Problems with the file are fixed in it, and the file chosen again: Chromium won't send
			// it again once it has changed, and other browsers may send it as it was (MEA-129).
			// Problems that come with duplicates are with the names typed for Rename, so the file
			// stays, to be sent again with the choices. A file that changed is chosen again too.
			if ((next.problems && !next.duplicates) || next.error === CHANGED) fileInput.value = '';
			await show(next);
		};
	};
</script>

<svelte:head>
	<title>Import recipes · Meals</title>
</svelte:head>

<!-- Without adding a Back step, as Cancel does (MEA-241). -->
<a class="link-tap back" href="/recipes" onclick={returnOnClick}>‹ Recipes</a>

<h1>Import recipes</h1>

<p>
	Add many recipes at once from a spreadsheet saved as a CSV file, one recipe per row. Help
	explains the columns.
</p>
<p><a class="link-tap" href="/recipes/import/template" download>Download template</a></p>

<form method="POST" action="?/import" enctype="multipart/form-data" use:enhance={submit}>
	{#if outcome?.error}
		<div class="card problems" role="alert">
			<p tabindex="-1" bind:this={messageElement}>{outcome.error}</p>
		</div>
	{:else if outcome?.problems && outcome.problems.length > 0}
		<div class="card problems" role="alert">
			<p tabindex="-1" bind:this={messageElement}>
				<strong>Nothing was imported.</strong>
				{outcome.duplicates
					? 'Fix these problems, then import again.'
					: 'Fix these problems, then choose the file again.'}
			</p>
			<ul>
				{#each outcome.problems as problem (problem)}
					<li>{problem}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="field">
		<label for="file">CSV file</label>
		<!-- A different file drops the choices made for the last one. -->
		<input
			id="file"
			name="file"
			type="file"
			accept=".csv,text/csv"
			required
			bind:this={fileInput}
			onchange={() => (outcome = null)}
		/>
	</div>

	{#if outcome?.duplicates}
		<section class="card" aria-labelledby="duplicates-heading">
			<h2 id="duplicates-heading">Already in Recipes</h2>
			{#if !outcome.problems?.length}
				<p tabindex="-1" bind:this={messageElement}>
					These recipes are already in Recipes. Choose what to do with each, then tap Import.
				</p>
			{/if}
			<ul class="list duplicates">
				{#each outcome.duplicates as duplicate (duplicate.row)}
					<li>
						<fieldset>
							<legend>
								<strong>{duplicate.name}</strong>
								<span class="muted">(row {duplicate.row})</span>
								{#if duplicate.archived}<span class="badge">Archived</span>{/if}
							</legend>
							<div class="choices">
								<label>
									<input
										type="radio"
										name="choice-{duplicate.row}"
										value="skip"
										bind:group={choices[duplicate.row]}
									/>
									Skip
								</label>
								<label>
									<input
										type="radio"
										name="choice-{duplicate.row}"
										value="replace"
										bind:group={choices[duplicate.row]}
									/>
									Replace
								</label>
								<label>
									<input
										type="radio"
										name="choice-{duplicate.row}"
										value="rename"
										bind:group={choices[duplicate.row]}
									/>
									Rename
								</label>
							</div>
							{#if choices[duplicate.row] === 'rename'}
								<label for="rename-{duplicate.row}">New name</label>
								<input
									id="rename-{duplicate.row}"
									name="rename-{duplicate.row}"
									maxlength="80"
									autocomplete="off"
									required
									bind:value={names[duplicate.row]}
								/>
							{/if}
						</fieldset>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<div class="actions">
		<button class="primary" disabled={!ready || importing}>
			{importing ? 'Importing…' : 'Import'}
		</button>
		<!-- Without adding a Back step (MEA-156). -->
		<a class="button" href="/recipes" onclick={returnOnClick}>Cancel</a>
	</div>
</form>

<style>
	.back {
		font-weight: 700;
	}

	.problems {
		border-color: var(--danger);
	}

	.problems p {
		margin: 0;
		scroll-margin-top: 6rem;
	}

	.problems ul {
		margin: 0.5rem 0 0;
		padding-left: 1.25rem;
	}

	.duplicates {
		padding: 0;
	}

	fieldset {
		border: none;
		margin: 0;
		padding: 0.5rem 0;
	}

	legend {
		padding: 0;
		overflow-wrap: anywhere;
	}

	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 0 1.25rem;
		margin: 0.25rem 0;
	}

	.choices label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: var(--tap);
		font-weight: normal;
	}

	.choices input {
		width: auto;
	}

	.actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 1rem;
	}
</style>

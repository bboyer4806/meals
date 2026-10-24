<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import type { Duplicate, DuplicateChoice } from '#lib/server/recipe-import.ts';

	// Import recipes (design 7). The chosen file stays in the form, so after the duplicate
	// choices it's sent again with them. Nothing is kept on the server in between.

	type Outcome = { problems?: string[]; duplicates?: Duplicate[] };

	let outcome = $state<Outcome | null>(null);
	let choices = $state<Record<number, DuplicateChoice>>({});
	let names = $state<Record<number, string>>({});
	let importing = $state(false);
	let messageElement = $state<HTMLElement>();

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

	const submit: SubmitFunction = ({ cancel }) => {
		if (importing) return cancel();
		importing = true;
		return async ({ result, update }) => {
			if (result.type === 'redirect') return update();
			importing = false;
			if (result.type === 'success' || result.type === 'failure') {
				await show(result.data as Outcome);
			} else {
				await show({
					problems: ["The file couldn't be imported. Check your connection and try again."]
				});
			}
		};
	};
</script>

<svelte:head>
	<title>Import recipes · Meals</title>
</svelte:head>

<a class="link-tap back" href="/recipes">‹ Recipes</a>

<h1>Import recipes</h1>

<p>
	Add many recipes at once from a spreadsheet saved as a CSV file, one recipe per row. Help
	explains the columns.
</p>
<p><a class="link-tap" href="/recipes/import/template" download>Download template</a></p>

<form method="POST" action="?/import" enctype="multipart/form-data" use:enhance={submit}>
	{#if outcome?.problems && outcome.problems.length > 0}
		<div class="card problems" role="alert">
			<p tabindex="-1" bind:this={messageElement}>
				<strong>Nothing was imported.</strong> Fix these problems, then import again.
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
		<a class="button" href="/recipes">Cancel</a>
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
		margin: 0 0 0.5rem;
		scroll-margin-top: 6rem;
	}

	.problems ul {
		margin: 0;
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

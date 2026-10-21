<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';

	// The first-time tour on the Grocery list (design 7, "Tour"): one step per control, each
	// found by its data-tour attribute in the layout. As a modal dialog it keeps the page behind
	// from being tapped, and Escape ends it like Skip. Reloading or leaving before Done or Skip
	// records nothing, so it starts again from the first step next time.

	const STEPS = [
		{ target: 'groceries', title: 'Groceries', text: "Your household's shopping list, by store." },
		{ target: 'menu', title: 'Menu', text: "Plan the week's dinners and see dish requests." },
		{ target: 'recipes', title: 'Recipes', text: "Your household's recipes, to cook or plan with." },
		{ target: 'more', title: 'More', text: "Items, History, Household, What's new and Sign out." },
		{ target: 'help', title: 'Help', text: "Explains the screen you're on and how to use it." },
		{ target: 'feedback', title: 'Send feedback', text: "Tell us what works, what doesn't, or an idea." }
	];

	const uid = $props.id();
	let dialog: HTMLDialogElement;
	let form: HTMLFormElement;
	let next: HTMLButtonElement;
	let index = $state(0);
	let spot = $state<DOMRect>();
	let innerHeight = $state(0);

	const step = $derived(STEPS[index]!);
	const last = $derived(index === STEPS.length - 1);

	function measure() {
		const control = document.querySelector(`[data-tour="${step.target}"]`);
		if (!control) throw new Error(`No control for the tour step "${step.target}"`);
		spot = control.getBoundingClientRect();
	}

	onMount(() => {
		dialog.showModal();
		next.focus();
	});

	$effect(measure);
</script>

<svelte:window bind:innerHeight onresize={measure} />

<dialog
	bind:this={dialog}
	aria-labelledby="{uid}-title"
	aria-describedby="{uid}-text"
	oncancel={() => form.requestSubmit()}
>
	{#if spot}
		<div
			class="spot"
			style:top="{spot.top}px"
			style:left="{spot.left}px"
			style:width="{spot.width}px"
			style:height="{spot.height}px"
		></div>
	{/if}
	<!-- Above the control when it's in the lower half of the screen, otherwise below it. -->
	<div
		class="card"
		style:top={spot && spot.top < innerHeight / 2 ? `${spot.bottom + 16}px` : undefined}
		style:bottom={spot && spot.top >= innerHeight / 2 ? `${innerHeight - spot.top + 16}px` : undefined}
	>
		<div aria-live="polite">
			<p class="muted">{index + 1} of {STEPS.length}</p>
			<h2 id="{uid}-title">{step.title}</h2>
			<p id="{uid}-text">{step.text}</p>
		</div>
		<form
			method="POST"
			action="?/tourSeen"
			bind:this={form}
			use:enhance={() => {
				dialog.close();
			}}
		>
			<button class="quiet">Skip</button>
			<button
				type="button"
				class="primary"
				bind:this={next}
				onclick={() => (last ? form.requestSubmit() : (index += 1))}
			>
				{last ? 'Done' : 'Next'}
			</button>
		</form>
	</div>
</dialog>

<style>
	/* Covers the screen, transparent, so the spotlight can dim everything but the control. */
	dialog {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		max-width: none;
		max-height: none;
		margin: 0;
		padding: 0;
		border: none;
		background: transparent;
		overflow: hidden;
	}

	dialog::backdrop {
		background: transparent;
	}

	.spot {
		position: fixed;
		border-radius: var(--radius);
		outline: 3px solid var(--accent);
		outline-offset: 2px;
		box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0.45);
	}

	.card {
		position: fixed;
		left: 0;
		right: 0;
		width: min(22rem, calc(100% - 2rem));
		margin: 0 auto;
		padding: 1rem;
		border-radius: 18px;
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow);
	}

	h2,
	p {
		margin: 0 0 0.5rem;
	}

	form {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
</style>

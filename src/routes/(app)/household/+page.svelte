<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import TimeZoneSelect from '#lib/components/TimeZoneSelect.svelte';
	import { keepPage, problemIn } from '#lib/submit.ts';

	let { data, form } = $props();

	/** The household's settings as they're saved. */
	function savedSettings() {
		const { name, defaultServings, timeZone } = data.household;
		return { name, defaultServings, timeZone };
	}

	// The settings fields are bound to state here, copied from the page's data once and again only
	// after a successful Save, so what's typed survives the data reloading when someone comes back
	// to the tab or adds a store (Q11, MEA-130), as in the recipe editor. (A field with value={...}
	// instead is set back to what's saved whenever the data reloads.) The servings field puts a
	// number back in, or null when it's emptied.
	let settings = $state<{ name: string; defaultServings: number | null; timeZone: string }>(
		untrack(savedSettings)
	);

	// Once saved, the fields show the settings as saved, such as the name without extra spaces.
	const saveSettings: SubmitFunction = () => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type === 'success') settings = savedSettings();
	};

	const activeStores = $derived(data.stores.filter((store) => store.archivedAt === null));
	const archivedStores = $derived(data.stores.filter((store) => store.archivedAt !== null));

	let editingStore = $state<{ id: number; name: string } | null>(null);
	let storeSheetOpen = $state(false);
	// Rebuilt every time the sheet opens, so edits abandoned last time don't come back.
	let storeSheetKey = $state(0);
	let storeSheetError = $state('');

	function editStore(store: { id: number; name: string }) {
		editingStore = store;
		storeSheetKey += 1;
		storeSheetError = '';
		storeSheetOpen = true;
	}

	function messageFor(action: string) {
		return form?.action === action ? form : null;
	}

	/**
	 * Sends a form whose messages show as `action`'s. When it can't be done, its message shows
	 * there as the server's would, and the page and what was typed stay (MEA-111).
	 */
	function send(action: string, submit?: SubmitFunction): SubmitFunction {
		return keepPage((error) => (form = { action, error }), submit);
	}
</script>

<svelte:head>
	<title>Household · Meals</title>
</svelte:head>

<h1>Household</h1>

<section class="card">
	<h2>Settings</h2>
	<form
		method="POST"
		action="?/settings"
		use:enhance={send('settings', saveSettings)}
	>
		{#if messageFor('settings')?.error}<p class="error" role="alert">{form?.error}</p>{/if}
		{#if messageFor('settings')?.message}<p role="status">{form?.message}</p>{/if}
		<div class="field">
			<label for="name">Household name</label>
			<input id="name" name="name" required maxlength="60" bind:value={settings.name} />
		</div>
		<div class="field">
			<label for="defaultServings">Usual number of servings</label>
			<input
				id="defaultServings"
				name="defaultServings"
				type="number"
				inputmode="numeric"
				min="1"
				max="50"
				required
				bind:value={settings.defaultServings}
			/>
		</div>
		<div class="field">
			<label for="timeZone">Time zone</label>
			<TimeZoneSelect timeZones={data.timeZones} bind:value={settings.timeZone} />
		</div>
		<button class="primary">Save</button>
	</form>
</section>

<section class="card">
	<h2>Members</h2>
	{#if messageFor('members')?.error}<p class="error" role="alert">{form?.error}</p>{/if}
	<ul class="list">
		{#each data.members as member (member.id)}
			<li class="row">
				<div class="grow">
					<strong>{member.displayName}</strong>
					<div class="muted">{member.email}</div>
				</div>
				{#if member.id === data.user.id}
					<span class="muted">You</span>
				{:else}
					<form method="POST" action="?/removeMember" use:enhance={send('members')}>
						<input type="hidden" name="id" value={member.id} />
						<ConfirmButton
							label="Remove"
							message={`Remove ${member.displayName}? They won't be able to sign in until someone invites them again.`}
							confirmLabel="Remove"
							danger
						/>
					</form>
				{/if}
			</li>
		{/each}
	</ul>

	<h3>Invite someone</h3>
	<form method="POST" action="?/invite" use:enhance={send('invite')} class="row">
		<label class="visually-hidden" for="invite-email">Email</label>
		<input
			class="grow"
			id="invite-email"
			name="email"
			type="email"
			required
			autocomplete="off"
			placeholder="Their Google email"
		/>
		<button class="primary">Invite</button>
	</form>
	{#if messageFor('invite')?.error}<p class="error" role="alert">{form?.error}</p>{/if}
	{#if messageFor('invite')?.message}<p role="status">{form?.message}</p>{/if}
	{#if data.invites.length > 0}
		<p class="muted">Waiting for them to join:</p>
		<ul class="list">
			{#each data.invites as invite (invite.id)}
				<li class="row">
					<span class="grow">{invite.email}</span>
					<form method="POST" action="?/cancelInvite" use:enhance={send('invite')}>
						<input type="hidden" name="id" value={invite.id} />
						<button class="quiet">Cancel</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="card">
	<h2>Stores</h2>
	<form method="POST" action="?/addStore" use:enhance={send('stores')} class="row">
		<label class="visually-hidden" for="store-name">Store name</label>
		<input class="grow" id="store-name" name="name" required maxlength="40" placeholder="Store name" />
		<button class="primary">Add</button>
	</form>
	{#if messageFor('stores')?.error}<p class="error" role="alert">{form?.error}</p>{/if}
	{#if activeStores.length === 0}
		<p class="muted">Add the stores you buy from, like Walmart or Aldi.</p>
	{:else}
		<ul class="list">
			{#each activeStores as store (store.id)}
				<li class="row">
					<span class="grow">{store.name}</span>
					<button class="quiet" onclick={() => editStore(store)}>Edit</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if archivedStores.length > 0}
		<h3>Archived</h3>
		<ul class="list">
			{#each archivedStores as store (store.id)}
				<li class="row">
					<span class="grow muted">{store.name}</span>
					<form method="POST" action="?/restoreStore" use:enhance={send('stores')}>
						<input type="hidden" name="id" value={store.id} />
						<button class="quiet">Restore</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<Sheet bind:open={storeSheetOpen} title="Edit store">
	{#if editingStore}
		{#key storeSheetKey}
			<form
				method="POST"
				action="?/renameStore"
				use:enhance={() =>
					async ({ result, update }) => {
						// The sheet stays open with what was typed (MEA-111).
						const problem = problemIn(result);
						if (problem !== null) {
							storeSheetError = problem;
							return;
						}
						await update({ reset: false });
						if (result.type === 'success') storeSheetOpen = false;
					}}
			>
				{#if storeSheetError}<p class="error" role="alert">{storeSheetError}</p>{/if}
				<input type="hidden" name="id" value={editingStore.id} />
				<div class="field">
					<label for="rename-store">Name</label>
					<input id="rename-store" name="name" required maxlength="40" value={editingStore.name} />
				</div>
				<div class="row">
					<button class="primary">Save</button>
					<ConfirmButton
						label="Archive"
						message={`Archive ${editingStore.name}? Lines already assigned to it keep it, but it won't be offered for new ones.`}
						confirmLabel="Archive"
						formaction="?/archiveStore"
					/>
				</div>
			</form>
		{/key}
	{/if}
</Sheet>

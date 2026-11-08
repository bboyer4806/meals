<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	/** "3 of 8 bought", or that there's nothing on it yet. */
	function progress(list: (typeof data.lists)[number]) {
		if (list.itemCount === 0) return 'Nothing on it yet';
		return `${list.doneCount} of ${list.itemCount} bought`;
	}
</script>

<svelte:head>
	<title>Party lists · Meals</title>
</svelte:head>

<a class="link-tap back" href="/groceries">‹ Groceries</a>

<h1>Party lists</h1>

<form class="new card" method="POST" action="?/create" use:enhance aria-label="New party list">
	<div class="row">
		<label class="visually-hidden" for="list-name">Name</label>
		<input
			class="grow"
			id="list-name"
			name="name"
			required
			maxlength="60"
			placeholder="Name, like Birthday party"
		/>
		<button class="primary">New list</button>
	</div>
	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
</form>

{#if data.lists.length === 0}
	<p class="muted">No party lists yet. Name one above to start it.</p>
{:else}
	<section class="card">
		<ul class="list">
			{#each data.lists as list (list.id)}
				<li>
					<a class="row party" href="/groceries/parties/{list.id}">
						<span class="grow name">{list.name}</span>
						<span class="muted">{progress(list)}</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.back {
		font-weight: 700;
	}

	.new .error {
		margin: 0.5rem 0 0;
	}

	.party {
		min-height: var(--tap);
		color: inherit;
		text-decoration: none;
		flex-wrap: wrap;
		column-gap: 1rem;
	}

	/* A long name without spaces wraps rather than widening the list past the screen. */
	.name {
		font-weight: 700;
		overflow-wrap: anywhere;
	}
</style>

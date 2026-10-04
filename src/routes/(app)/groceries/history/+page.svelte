<script lang="ts">
	import { formatDateLabel } from '#lib/dates.ts';
	import { formatQuantity } from '#lib/text.ts';

	let { data } = $props();
</script>

<svelte:head>
	<title>History · Meals</title>
</svelte:head>

<h1>History</h1>

<form method="GET" class="row search">
	<label class="visually-hidden" for="q">Search history</label>
	<input class="grow" id="q" name="q" type="search" placeholder="Search" value={data.search} />
	<button>Search</button>
</form>

{#if data.days.length === 0}
	<p class="muted">Nothing received yet{data.search ? ` matching “${data.search}”` : ''}.</p>
{/if}

{#each data.days as day (day.date)}
	<section class="card">
		<h2>{formatDateLabel(day.date)}</h2>
		<ul class="list">
			{#each day.lines as line (line.id)}
				<li class="row">
					<span class="grow">
						<strong>{line.itemName}</strong>
						{formatQuantity(line.quantity)}{line.unit ? ` ${line.unit}` : ''}
					</span>
					<span class="muted">{line.storeName}</span>
				</li>
			{/each}
		</ul>
	</section>
{/each}

{#if data.more}
	<a class="button" href="?q={encodeURIComponent(data.search)}&show={data.more}">Show older</a>
{/if}

<style>
	.search {
		margin-bottom: 1rem;
	}
</style>

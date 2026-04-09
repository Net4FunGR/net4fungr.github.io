# Mutable vs. Immutable


Have you noticed that in some parts of the world, in some cafeterias, especially when the weather is hot, after you take your seat, a waiter comes and serves you a glass of water? Furthermore, in these places, the waiter has a frequent task to have this glass filled several times during your stay. Hence, we could say that the waiter has a task every once in a while to take a jug of water and re-fill the glasses of those customers that are not full, even if they are half-empty or half-full.

We can say that the glass of water, in that case, is a **mutable** object, i.e. the glass is brought full at first and then its status can be changed by refilling it again. In addition, the task is **idempotent** because every time it is executed, the result would be the same, i.e. all glasses are full - unless someone asks no to have it filled :smile:.

This drinking water idempotency task can also be seen in expensive restaurants, where again there is a waiter (maybe call him idempotent) that takes care of re-filling your glass and in such places it happens much more often and usually it happens per-table rather than for all customers at the same time :smile:. Now, this glass idempotency thing does not only apply to drinking water, but also to the wine glasses if you have ordered a bottle of wine, that is.  

But, what happens if you have only ordered and consumed a single glass of wine? Your glass is empty and the waiter will come and ask you if you'd like another one. You say yes, and then it happens. The waiter will take the empty glass and will go and fetch a new glass of wine for you, i.e. replacing the previous one. At this moment, you realize that the wine glass is not a mutable object, but it is **immutable** :smile:. It cannot be re-filled, it cannot be changed and it has to be replaced by another glass of wine that could be the same or some other type, or something completely different, but they all will refer to the _object_ you drink. 

You enjoyed your wine, it fulfilled its purpose, but if you want it to serve it's purpose again, it has to be replaced with a new one or a new drink :smile:







---

> Author:    
> URL: https://net4fungr.github.io/posts/mutable-immutable/  

